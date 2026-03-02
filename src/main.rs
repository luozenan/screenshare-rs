use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SignalMessage {
    #[serde(rename = "type")]
    type_: String,
    #[serde(default, rename = "roomId")]
    room_id: Option<String>,
    #[serde(default, rename = "userId")]
    user_id: Option<String>,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    sdp: Option<String>,
    #[serde(default)]
    candidate: Option<serde_json::Value>,
    #[serde(default, rename = "isSharer")]
    is_sharer: Option<bool>,
}

#[derive(Debug, Clone)]
struct RoomState {
    users: Vec<String>,
    sharer: Option<String>,
}

type RoomsState = Arc<Mutex<HashMap<String, RoomState>>>;
type ClientsState = Arc<Mutex<HashMap<String, futures_util::stream::SplitSink<WebSocket, Message>>>>;
type UserRoomState = Arc<Mutex<HashMap<String, String>>>;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let rooms: RoomsState = Arc::new(Mutex::new(HashMap::new()));
    let clients: ClientsState = Arc::new(Mutex::new(HashMap::new()));
    let user_rooms: UserRoomState = Arc::new(Mutex::new(HashMap::new()));

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state((rooms, clients, user_rooms))
        .fallback_service(ServeDir::new("static"));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    tracing::info!("🚀 Server running on http://{}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State((rooms, clients, user_rooms)): State<(RoomsState, ClientsState, UserRoomState)>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, rooms, clients, user_rooms))
}

async fn handle_socket(
    socket: WebSocket,
    rooms: RoomsState,
    clients: ClientsState,
    user_rooms: UserRoomState,
) {
    let (mut sender, mut receiver) = socket.split();
    let client_id = Uuid::new_v4().to_string();

    let assigned_msg = serde_json::json!({
        "type": "assigned",
        "id": client_id
    });
    if sender.send(Message::Text(assigned_msg.to_string().into())).await.is_err() {
        return;
    }

    {
        let mut clients_map = clients.lock().await;
        clients_map.insert(client_id.clone(), sender);
        tracing::info!("✅ 用户 {} 已连接", client_id);
    }

    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(signal) = serde_json::from_str::<SignalMessage>(&text) {
                handle_signal(
                    signal,
                    client_id.clone(),
                    rooms.clone(),
                    clients.clone(),
                    user_rooms.clone(),
                ).await;
            }
        }
    }

    cleanup(&client_id, rooms, clients, user_rooms).await;
}

async fn handle_signal(
    signal: SignalMessage,
    client_id: String,
    rooms: RoomsState,
    clients: ClientsState,
    user_rooms: UserRoomState,
) {
    match signal.type_.as_str() {
        "join" => {
            let room_id = signal.room_id.unwrap_or_default();
            let is_sharer = signal.is_sharer.unwrap_or(false);

            user_rooms.lock().await.insert(client_id.clone(), room_id.clone());

            let mut rooms_map = rooms.lock().await;
            let room = rooms_map.entry(room_id.clone()).or_insert_with(|| RoomState {
                users: Vec::new(),
                sharer: None,
            });

            room.users.push(client_id.clone());
            if is_sharer {
                room.sharer = Some(client_id.clone());
            }

            drop(rooms_map);

            let msg = serde_json::json!({
                "type": "user-connected",
                "userId": client_id.clone()
            });

            broadcast_to_room(&room_id, &client_id, &msg, &rooms, &clients).await;
            tracing::info!("✅ 用户 {} 加入房间 {}", client_id, room_id);
        }

        "offer" => {
            if let (Some(to), Some(sdp)) = (signal.to, signal.sdp) {
                let msg = serde_json::json!({
                    "type": "offer",
                    "from": client_id.clone(),
                    "sdp": sdp
                });
                send_to_user(&to, &msg, &clients).await;
                tracing::info!("📤 转发Offer从 {} 到 {}", client_id, to);
            }
        }

        "answer" => {
            if let (Some(to), Some(sdp)) = (signal.to, signal.sdp) {
                let msg = serde_json::json!({
                    "type": "answer",
                    "from": client_id.clone(),
                    "sdp": sdp
                });
                send_to_user(&to, &msg, &clients).await;
                tracing::info!("📩 转发Answer从 {} 到 {}", client_id, to);
            }
        }

        "ice-candidate" => {
            if let (Some(to), Some(candidate)) = (signal.to, signal.candidate) {
                let msg = serde_json::json!({
                    "type": "ice-candidate",
                    "from": client_id.clone(),
                    "candidate": candidate
                });
                send_to_user(&to, &msg, &clients).await;
            }
        }

        "sharing-start" => {
            if let Some(room_id) = signal.room_id {
                let msg = serde_json::json!({
                    "type": "sharing-start",
                    "userId": client_id.clone()
                });
                broadcast_to_room(&room_id, &client_id, &msg, &rooms, &clients).await;
                tracing::info!("🎬 用户 {} 开始共享屏幕", client_id);
            }
        }

        "sharing-stop" => {
            if let Some(room_id) = signal.room_id {
                let msg = serde_json::json!({
                    "type": "sharing-stop",
                    "userId": client_id.clone()
                });
                broadcast_to_room(&room_id, &client_id, &msg, &rooms, &clients).await;
                tracing::info!("🛑 用户 {} 停止共享屏幕", client_id);
            }
        }

        _ => {
            tracing::warn!("❌ 未知消息类型: {}", signal.type_);
        }
    }
}

async fn broadcast_to_room(
    room_id: &str,
    exclude_user: &str,
    message: &serde_json::Value,
    rooms: &RoomsState,
    clients: &ClientsState,
) {
    let msg_text = message.to_string();
    
    let rooms_map = rooms.lock().await;
    if let Some(room) = rooms_map.get(room_id) {
        let target_users: Vec<_> = room.users.iter()
            .filter(|id| *id != exclude_user)
            .cloned()
            .collect();
        drop(rooms_map);
        
        let mut clients_map = clients.lock().await;
        for user_id in target_users {
            if let Some(sender) = clients_map.get_mut(&user_id) {
                let _ = sender.send(Message::Text(msg_text.clone().into())).await;
            }
        }
    }
}

async fn send_to_user(
    user_id: &str,
    message: &serde_json::Value,
    clients: &ClientsState,
) {
    let msg_text = message.to_string();
    let mut clients_map = clients.lock().await;

    if let Some(sender) = clients_map.get_mut(user_id) {
        let _ = sender.send(Message::Text(msg_text.into())).await;
    }
}

async fn cleanup(
    user_id: &str,
    rooms: RoomsState,
    clients: ClientsState,
    user_rooms: UserRoomState,
) {
    let room_id = user_rooms.lock().await.remove(user_id);

    if let Some(room_id) = room_id {
        let mut rooms_map = rooms.lock().await;
        if let Some(room) = rooms_map.get_mut(&room_id) {
            room.users.retain(|id| id != user_id);
            if room.sharer.as_ref() == Some(&user_id.to_string()) {
                room.sharer = None;
            }

            let msg = serde_json::json!({
                "type": "user-disconnected",
                "userId": user_id
            });

            let msg_text = msg.to_string();
            let mut clients_map = clients.lock().await;
            for other_id in &room.users {
                if let Some(sender) = clients_map.get_mut(other_id) {
                    let _ = sender.send(Message::Text(msg_text.clone().into())).await;
                }
            }

            if room.users.is_empty() {
                let _ = room;
                rooms_map.remove(&room_id);
                tracing::info!("🗑️ 房间 {} 已清空", room_id);
            }
        }
    }

    clients.lock().await.remove(user_id);
    tracing::info!("✅ 用户 {} 已断开连接", user_id);
}

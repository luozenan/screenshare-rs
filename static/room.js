// ========== 全局状态 ==========
let ws = null;
let roomId = null;
let userId = null;
let myStream = null;
let myVideo = null;
let isSharing = false; // 当前是否是共享者

const peers = new Map(); // userId -> { pc, stream, video }
const iceCandidateBuffers = new Map(); // userId -> ICE候选缓冲

// ========== UI 元素 ==========
let videoGrid, startShareBtn, copyLinkBtn, endShareBtn, exitMeetingBtn;
let roomInfo, roomCode, toast, connectionStatus, userCountEl, roleStatus;

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    // 获取UI元素
    videoGrid = document.getElementById('videoGrid');
    startShareBtn = document.getElementById('startShare');
    copyLinkBtn = document.getElementById('copyLink');
    endShareBtn = document.getElementById('endShare');
    exitMeetingBtn = document.getElementById('exitMeeting');
    roomInfo = document.getElementById('roomInfo');
    roomCode = document.getElementById('roomCode');
    toast = document.getElementById('toast');
    connectionStatus = document.getElementById('connectionStatus');
    userCountEl = document.getElementById('userCount');
    roleStatus = document.getElementById('roleStatus');
    
    // 获取房间ID
    const params = new URLSearchParams(window.location.search);
    roomId = params.get('room');
    
    if (!roomId) {
        showToast('未指定房间，跳转到首页', 'error');
        setTimeout(() => {
            window.location.href = 'create-room.html';
        }, 1500);
        return;
    }
    
    // 显示房间信息
    if (roomInfo) {
        roomInfo.style.display = 'block';
    }
    if (roomCode) {
        roomCode.textContent = decodeURIComponent(roomId);
    }
    
    // 绑定按钮事件
    startShareBtn.addEventListener('click', startScreenShare);
    copyLinkBtn.addEventListener('click', copyRoomLink);
    endShareBtn.addEventListener('click', stopScreenShare);
    exitMeetingBtn.addEventListener('click', exitMeeting);
    
    // 连接信令服务器
    connectToSignalingServer();
});

// ========== 信令服务器连接 ==========
function connectToSignalingServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws';
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ 已连接到信令服务器');
        if (connectionStatus) connectionStatus.textContent = '已连接';
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('📥 收到消息:', data);
        
        // 分发消息
        if (data.type === 'assigned') {
            userId = data.id;
            console.log('✅ 分配用户ID:', userId);
            
            // 加入房间
            sendMessage({
                type: 'join',
                roomId: roomId,
                userId: userId
            });
        } else if (data.type === 'offer') {
            handleOffer(data);
        } else if (data.type === 'answer') {
            handleAnswer(data);
        } else if (data.type === 'ice-candidate') {
            handleIceCandidate(data);
        } else if (data.type === 'user-connected') {
            handleUserConnected(data);
        } else if (data.type === 'user-disconnected') {
            handleUserDisconnected(data);
        } else if (data.type === 'sharing-start') {
            handleSharingStart(data);
        } else if (data.type === 'sharing-stop') {
            handleSharingStop(data);
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket错误:', error);
        if (connectionStatus) connectionStatus.textContent = '连接错误';
    };
    
    ws.onclose = () => {
        console.log('❌ 信令服务器断开');
        if (connectionStatus) connectionStatus.textContent = '已断开';
        setTimeout(connectToSignalingServer, 3000);
    };
}

function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('📤 发送消息:', msg.type);
        ws.send(JSON.stringify(msg));
    }
}

// ========== 屏幕共享 ==========
async function startScreenShare() {
    if (isSharing) {
        showToast('已在屏幕共享中', 'error');
        return;
    }
    
    try {
        console.log('🎬 开始屏幕共享...');
        showToast('正在请求屏幕权限...');
        
        // 获取屏幕流
        myStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });
        
        console.log('✅ 获取屏幕流成功');
        
        // 标记为共享者
        isSharing = true;
        if (roleStatus) roleStatus.textContent = '共享者';
        
        // 创建本地视频元素
        myVideo = createVideoElement('我的屏幕', true);
        myVideo.srcObject = myStream;
        
        // 通知其他用户屏幕共享开始
        sendMessage({
            type: 'sharing-start',
            roomId: roomId,
            userId: userId
        });
        
        // 延迟一秒后为所有现有的peer创建Offer
        // 这样可以确保观看者有时间接收 sharing-start 消息
        setTimeout(() => {
            console.log('📢 为所有观看者创建Offer');
            peers.forEach((_peerData, remoteUserId) => {
                createAndSendOffer(remoteUserId);
            });
        }, 500);
        
        // 更新UI
        startShareBtn.style.display = 'none';
        endShareBtn.style.display = 'inline-block';
        showToast('屏幕共享已启动');
        
        // 监听流结束
        myStream.getVideoTracks()[0].onended = stopScreenShare;
        
    } catch (err) {
        console.error('❌ 屏幕共享失败:', err);
        if (err.name === 'NotAllowedError') {
            showToast('您拒绝了屏幕共享权限');
        } else if (err.name === 'NotFoundError') {
            showToast('未找到可共享的屏幕');
        } else {
            showToast('屏幕共享失败: ' + err.message);
        }
    }
}

async function stopScreenShare() {
    console.log('🛑 停止屏幕共享');
    
    // 停止所有流
    if (myStream) {
        myStream.getTracks().forEach(track => track.stop());
        myStream = null;
    }
    
    // 关闭所有peer连接
    peers.forEach((peerData) => {
        peerData.pc?.close();
    });
    peers.clear();
    iceCandidateBuffers.clear();
    
    // 清空视频网格（除了自己的）
    videoGrid.innerHTML = '';
    myVideo = null;
    
    // 标记为观看者
    isSharing = false;
    if (roleStatus) roleStatus.textContent = '观看者';
    
    // 通知其他用户屏幕共享结束
    sendMessage({
        type: 'sharing-stop',
        roomId: roomId,
        userId: userId
    });
    
    // 更新UI
    startShareBtn.style.display = 'inline-block';
    endShareBtn.style.display = 'none';
    showToast('屏幕共享已停止');
}

// ========== 复制房间链接 ==========
function copyRoomLink() {
    const roomUrl = window.location.href.split('?')[0] + '?room=' + roomId;
    navigator.clipboard.writeText(roomUrl).then(() => {
        showToast('房间链接已复制');
    }).catch(() => {
        showToast('复制失败，请手动复制: ' + roomUrl, 'error');
    });
}

// ========== WebRTC 信令处理 ==========
async function handleOffer(message) {
    const { from, sdp } = message;
    console.log('📨 收到Offer来自:', from);
    
    if (!peers.has(from)) {
        peers.set(from, { pc: null, stream: null, video: null });
    }
    
    const peerData = peers.get(from);
    
    // 如果已有活跃连接，跳过重复Offer
    if (peerData.pc && peerData.pc.connectionState !== 'closed') {
        console.log('⚠️ 已有活跃连接，跳过重复Offer');
        return;
    }
    
    try {
        // 创建Peer连接
        peerData.pc = createPeerConnection(from);
        
        // 设置远程Offer
        const sessionDesc = new RTCSessionDescription({ type: 'offer', sdp });
        await peerData.pc.setRemoteDescription(sessionDesc);
        console.log('✅ 设置远程Offer成功');
        
        // 创建Answer
        const answer = await peerData.pc.createAnswer();
        await peerData.pc.setLocalDescription(answer);
        console.log('✅ 创建Answer成功');
        
        // 发送Answer
        sendMessage({
            type: 'answer',
            to: from,
            sdp: answer.sdp,
            roomId: roomId
        });
        
        // 处理缓冲的ICE候选
        if (iceCandidateBuffers.has(from)) {
            const candidates = iceCandidateBuffers.get(from);
            for (const candidate of candidates) {
                await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            iceCandidateBuffers.delete(from);
        }
    } catch (error) {
        console.error('❌ handleOffer错误:', error.message);
        showToast('处理Offer失败: ' + error.message, 'error');
    }
}

async function handleAnswer(message) {
    const { from, sdp } = message;
    console.log('📩 收到Answer来自:', from);
    
    if (!peers.has(from)) {
        console.error('❌ 未找到对应的Peer:', from);
        return;
    }
    
    const peerData = peers.get(from);
    const sessionDesc = new RTCSessionDescription({ type: 'answer', sdp });
    await peerData.pc.setRemoteDescription(sessionDesc);
    console.log('✅ 设置远程Answer成功');
}

async function handleIceCandidate(message) {
    const { from, candidate } = message;
    
    if (!peers.has(from)) {
        // 缓冲ICE候选
        if (!iceCandidateBuffers.has(from)) {
            iceCandidateBuffers.set(from, []);
        }
        iceCandidateBuffers.get(from).push(candidate);
        console.log('📌 缓冲ICE候选');
        return;
    }
    
    const peerData = peers.get(from);
    if (peerData.pc) {
        await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

function handleUserConnected(message) {
    const { userId: connectedUserId } = message;
    console.log('👥 用户已连接:', connectedUserId);
    
    // 如果当前用户在共享，为新用户创建Offer
    if (isSharing && myStream) {
        createAndSendOffer(connectedUserId);
    }
    
    updateUserCount();
}

function handleUserDisconnected(message) {
    const { userId: disconnectedUserId } = message;
    console.log('👤 用户已断开:', disconnectedUserId);
    
    if (peers.has(disconnectedUserId)) {
        const peerData = peers.get(disconnectedUserId);
        
        // 清除视频流
        if (peerData.video) {
            peerData.video.srcObject = null;
        }
        
        // 关闭PeerConnection
        peerData.pc?.close();
        peers.delete(disconnectedUserId);
        
        // 移除对应的视频元素（使用一致的ID生成方式）
        const videoContainerId = 'video-' + disconnectedUserId.substring(0, 8);
        const videoContainer = document.getElementById(videoContainerId);
        if (videoContainer) {
            // 添加消失动画
            videoContainer.style.opacity = '0';
            videoContainer.style.transition = 'opacity 0.3s ease-out';
            setTimeout(() => {
                if (videoContainer.parentNode) {
                    videoContainer.remove();
                }
            }, 300);
        }
    }
    
    updateUserCount();
}

function handleSharingStart(message) {
    const { userId: sharerUserId } = message;
    if (sharerUserId !== userId) {
        console.log('🎬 用户开始共享屏幕:', sharerUserId);
        
        // 如果当前用户不在共享，则为共享者创建连接
        if (!isSharing) {
            createAndSendOffer(sharerUserId);
        }
    }
}

function handleSharingStop(message) {
    const { userId: sharerUserId } = message;
    if (sharerUserId !== userId) {
        console.log('🛑 用户停止共享屏幕:', sharerUserId);
        
        // 关闭该用户的连接
        if (peers.has(sharerUserId)) {
            const peerData = peers.get(sharerUserId);
            
            // 清除视频流
            if (peerData.video) {
                peerData.video.srcObject = null;
            }
            
            // 关闭PeerConnection
            peerData.pc?.close();
            peers.delete(sharerUserId);
            
            // 移除对应的视频元素（使用一致的ID生成方式）
            const videoContainerId = 'video-' + sharerUserId.substring(0, 8);
            const videoContainer = document.getElementById(videoContainerId);
            if (videoContainer) {
                // 添加消失动画
                videoContainer.style.opacity = '0';
                videoContainer.style.transition = 'opacity 0.3s ease-out';
                setTimeout(() => {
                    if (videoContainer.parentNode) {
                        videoContainer.remove();
                    }
                }, 300);
                console.log('✅ 视频元素已移除:', videoContainerId);
            } else {
                console.warn('⚠️ 未找到视频元素:', videoContainerId);
            }
        }
        
        iceCandidateBuffers.delete(sharerUserId);
        updateUserCount();
    }
}

// ========== Peer连接管理 ==========
function createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.qq.com:3478' },
            { urls: 'stun:stun.163.com:3478' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    
    // 如果当前用户在共享，添加本地流轨道
    if (isSharing && myStream) {
        myStream.getTracks().forEach(track => {
            pc.addTrack(track, myStream);
        });
        console.log('✅ 向PC添加本地媒体轨道');
    }
    
    // 处理远程轨道
    pc.ontrack = (event) => {
        console.log('🎬 收到远程轨道:', event.track.kind);
        
        const peerData = peers.get(remoteUserId);
        if (peerData) {
            const stream = event.streams[0];
            peerData.stream = stream;
            
            // 如果视频元素还未创建，创建它
            if (!peerData.video) {
                const label = '共享屏幕 ' + remoteUserId.substring(0, 8);
                peerData.video = createVideoElement(label, true);
            }
            
            peerData.video.srcObject = stream;
            
            // 确保视频开始播放
            peerData.video.play().catch(err => {
                console.warn('⚠️ 视频播放失败:', err.message);
            });
            
            console.log('✅ 视频流已绑定');
        }
    };
    
    // 处理ICE候选
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({
                type: 'ice-candidate',
                to: remoteUserId,
                candidate: event.candidate,
                roomId: roomId
            });
        }
    };
    
    // 处理连接状态变化
    pc.onconnectionstatechange = () => {
        console.log('🔗 连接状态:', pc.connectionState);
    };
    
    return pc;
}

async function createAndSendOffer(remoteUserId) {
    console.log('📤 为用户' + remoteUserId + '创建Offer');
    
    if (!peers.has(remoteUserId)) {
        peers.set(remoteUserId, { pc: null, stream: null, video: null });
    }
    
    const peerData = peers.get(remoteUserId);
    
    // 如果已有活跃连接，跳过重复创建
    if (peerData.pc && peerData.pc.connectionState !== 'closed') {
        console.log('⚠️ 已有活跃连接，跳过重复Offer');
        return;
    }
    
    try {
        peerData.pc = createPeerConnection(remoteUserId);
        
        // 创建Offer并明确表示要接收视频
        const offer = await peerData.pc.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: false
        });
        await peerData.pc.setLocalDescription(offer);
        console.log('✅ 创建Offer成功，已配置接收视频');
        
        sendMessage({
            type: 'offer',
            to: remoteUserId,
            sdp: offer.sdp,
            roomId: roomId
        });
    } catch (error) {
        console.error('❌ createAndSendOffer错误:', error.message);
        showToast('创建Offer失败: ' + error.message, 'error');
    }
}

// ========== 工具函数 ==========
function createVideoElement(label, autoplay = false) {
    const container = document.createElement('div');
    container.className = 'video-container';
    
    // 生成一致的ID：如果是自己的视频用'self'，否则用userId的前8个字符
    let containerId = 'video-self';
    if (!label.includes('我')) {
        // 从标签中提取userId（"共享屏幕 xxxxx" -> "xxxxx"）
        const parts = label.split(' ');
        if (parts.length > 1) {
            containerId = 'video-' + parts[1].substring(0, 8);
        }
    }
    container.id = containerId;
    
    const video = document.createElement('video');
    video.autoplay = autoplay;
    video.muted = autoplay;
    video.playsinline = true;
    
    const labelEl = document.createElement('div');
    labelEl.className = 'video-label';
    labelEl.textContent = label;
    
    container.appendChild(video);
    container.appendChild(labelEl);
    videoGrid.appendChild(container);
    
    console.log('📹 创建视频元素，ID:', containerId);
    return video;
}

function updateUserCount() {
    const count = peers.size + 1; // 加上自己
    if (userCountEl) userCountEl.textContent = count;
}

function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function exitMeeting() {
    // 关闭所有peer连接
    peers.forEach((peerData) => {
        if (peerData.pc) {
            peerData.pc.close();
        }
    });
    peers.clear();
    
    // 停止本地流
    if (myStream) {
        myStream.getTracks().forEach(track => track.stop());
        myStream = null;
    }
    
    // 关闭WebSocket连接
    if (ws) {
        ws.close();
    }
    
    // 关闭当前标签页
    window.close();
}

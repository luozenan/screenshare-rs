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
document.addEventListener("DOMContentLoaded", () => {
  // 获取UI元素
  videoGrid = document.getElementById("videoGrid");
  startShareBtn = document.getElementById("startShare");
  copyLinkBtn = document.getElementById("copyLink");
  endShareBtn = document.getElementById("endShare");
  exitMeetingBtn = document.getElementById("exitMeeting");
  roomInfo = document.getElementById("roomInfo");
  roomCode = document.getElementById("roomCode");
  toast = document.getElementById("toast");
  connectionStatus = document.getElementById("connectionStatus");
  userCountEl = document.getElementById("userCount");
  roleStatus = document.getElementById("roleStatus");

  // 获取房间ID
  const params = new URLSearchParams(window.location.search);
  roomId = params.get("room");

  if (!roomId) {
    showToast("未指定房间，跳转到首页", "error");
    setTimeout(() => {
      window.location.href = "create-room.html";
    }, 1500);
    return;
  }

  // 显示房间信息
  if (roomInfo) {
    roomInfo.style.display = "block";
  }
  if (roomCode) {
    roomCode.textContent = decodeURIComponent(roomId);
  }

  // 绑定按钮事件
  startShareBtn.addEventListener("click", startScreenShare);
  copyLinkBtn.addEventListener("click", copyRoomLink);
  endShareBtn.addEventListener("click", stopScreenShare);
  exitMeetingBtn.addEventListener("click", exitMeeting);

  // 连接信令服务器
  connectToSignalingServer();
});

// ========== 信令服务器连接 ==========
function connectToSignalingServer() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = protocol + "//" + window.location.host + "/ws";

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    if (connectionStatus) connectionStatus.textContent = "已连接";
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    // 分发消息
    if (data.type === "assigned") {
      userId = data.id;

      // 加入房间
      sendMessage({
        type: "join",
        roomId: roomId,
        userId: userId,
      });
    } else if (data.type === "offer") {
      handleOffer(data);
    } else if (data.type === "answer") {
      handleAnswer(data);
    } else if (data.type === "ice-candidate") {
      handleIceCandidate(data);
    } else if (data.type === "user-connected") {
      handleUserConnected(data);
    } else if (data.type === "user-disconnected") {
      handleUserDisconnected(data);
    } else if (data.type === "sharing-start") {
      handleSharingStart(data);
    } else if (data.type === "sharing-stop") {
      handleSharingStop(data);
    }
  };

  ws.onerror = (error) => {
    if (connectionStatus) connectionStatus.textContent = "连接错误";
  };

  ws.onclose = () => {
    if (connectionStatus) connectionStatus.textContent = "已断开";
    setTimeout(connectToSignalingServer, 3000);
  };
}

function sendMessage(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ========== 屏幕共享 ==========
async function startScreenShare() {
  if (isSharing) {
    showToast("已在屏幕共享中", "error");
    return;
  }

  try {
    showToast("正在请求屏幕权限...");

    // 获取屏幕流（尝试获取系统音频）
    // 注意：对于Linux系统，可能需要调整分辨率约束以提高兼容性
    const videoConstraints = {
      cursor: "always",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 60 }, // 显式设置帧率以提高兼容性
    };
    
    myStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: true,
    });

    // 诊断：检查是否获取到了音频轨道
    console.log('📊 本地屏幕共享流信息:');
    console.log(`  📹 视频轨道: ${myStream.getVideoTracks().length} 个`);
    console.log(`  🎤 音频轨道: ${myStream.getAudioTracks().length} 个`);
    
    // 检查视频轨道的设置
    myStream.getVideoTracks().forEach((track, idx) => {
      const settings = track.getSettings();
      console.log(`  [视频${idx}] 分辨率: ${settings.width}x${settings.height}, 帧率: ${settings.frameRate}`);
    });
    
    // 临时：保存系统音频的原始信息用于诊断
    const systemAudioTracks = myStream.getAudioTracks();
    const hasSystemAudio = systemAudioTracks.length > 0;
    if (hasSystemAudio) {
      console.log(`  ℹ️  检测到系统音频，详情：`);
      systemAudioTracks.forEach((track, idx) => {
        const settings = track.getSettings ? track.getSettings() : {};
        console.log(`    [系统音频${idx}] ${track.label} - 采样率: ${settings.sampleRate || '?'}, 通道: ${settings.channelCount || '?'}`);
      });
    } else {
      console.log(`  ⚠️  系统未提供音频轨道（这在Linux上很常见）`);
    }
    
    // 统一处理音频轨道：不管有没有系统音频，都移除所有音频轨道再添加静音轨道
    // 这样做是为了避免音频协商导致的兼容性问题
    myStream.getAudioTracks().forEach(track => {
      track.stop();
      myStream.removeTrack(track);
    });
    
    // 添加静音音频轨道供WebRTC传输（某些浏览器要求音频轨道存在）
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioContext.createMediaStreamDestination();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0, audioContext.currentTime);
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      const audioTrack = dest.stream.getAudioTracks()[0];
      myStream.addTrack(audioTrack);
      console.log(`  ✅ 已添加标准化静音音频轨道（替代${hasSystemAudio ? '系统音频' : '缺失的音频'}）`);
    } catch (err) {
      console.warn(`  ⚠️  无法添加音频轨道: ${err.message}`);
    }

    // 标记为共享者
    isSharing = true;
    if (roleStatus) roleStatus.textContent = "共享者";

    // 创建本地视频元素
    myVideo = createVideoElement("我的屏幕", true);
    myVideo.srcObject = myStream;

    // 通知其他用户屏幕共享开始
    sendMessage({
      type: "sharing-start",
      roomId: roomId,
      userId: userId,
    });

    // 延迟一秒后为所有现有的peer创建Offer
    // 这样可以确保观看者有时间接收 sharing-start 消息
    setTimeout(() => {
      peers.forEach((_peerData, remoteUserId) => {
        createAndSendOffer(remoteUserId);
      });
    }, 500);

    // 更新UI
    startShareBtn.style.display = "none";
    endShareBtn.style.display = "inline-block";
    showToast("屏幕共享已启动");

    // 监听流结束
    myStream.getVideoTracks()[0].onended = stopScreenShare;
  } catch (err) {
    if (err.name === "NotAllowedError") {
      showToast("您拒绝了屏幕共享权限");
    } else if (err.name === "NotFoundError") {
      showToast("未找到可共享的屏幕");
    } else {
      showToast("屏幕共享失败: " + err.message);
    }
  }
}

async function stopScreenShare() {
  // 停止所有流
  if (myStream) {
    myStream.getTracks().forEach((track) => track.stop());
    myStream = null;
  }

  // 关闭所有peer连接
  peers.forEach((peerData) => {
    peerData.pc?.close();
  });
  peers.clear();
  iceCandidateBuffers.clear();

  // 清空视频网格（除了自己的）
  videoGrid.innerHTML = "";
  myVideo = null;

  // 标记为观看者
  isSharing = false;
  if (roleStatus) roleStatus.textContent = "观看者";

  // 通知其他用户屏幕共享结束
  sendMessage({
    type: "sharing-stop",
    roomId: roomId,
    userId: userId,
  });

  // 更新UI
  startShareBtn.style.display = "inline-block";
  endShareBtn.style.display = "none";
  showToast("屏幕共享已停止");
}

// ========== 复制房间链接 ==========
function copyRoomLink() {
  const roomUrl = window.location.href.split("?")[0] + "?room=" + roomId;
  navigator.clipboard
    .writeText(roomUrl)
    .then(() => {
      showToast("房间链接已复制");
    })
    .catch(() => {
      showToast("复制失败，请手动复制: " + roomUrl, "error");
    });
}

// ========== WebRTC 信令处理 ==========
async function handleOffer(message) {
  const { from, sdp } = message;

  if (!peers.has(from)) {
    peers.set(from, { pc: null, stream: null, video: null });
  }

  const peerData = peers.get(from);

  // 如果已有活跃连接，跳过重复Offer
  if (peerData.pc && peerData.pc.connectionState !== "closed") {
    return;
  }

  try {
    // 创建Peer连接
    peerData.pc = createPeerConnection(from);

    // 优化接收的Offer的SDP，强制使用H264
    const optimizedSdp = forceH264Encoding(sdp);
    
    // 设置远程Offer
    const sessionDesc = new RTCSessionDescription({ type: "offer", sdp: optimizedSdp });
    await peerData.pc.setRemoteDescription(sessionDesc);

    // 创建Answer
    const answer = await peerData.pc.createAnswer();
    
    // 优化发送的Answer的SDP，强制使用H264
    const optimizedAnswerSdp = forceH264Encoding(answer.sdp);
    answer.sdp = optimizedAnswerSdp;
    
    await peerData.pc.setLocalDescription(answer);

    // 发送Answer
    sendMessage({
      type: "answer",
      to: from,
      sdp: answer.sdp,
      roomId: roomId,
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
    showToast("处理Offer失败: " + error.message, "error");
  }
}

async function handleAnswer(message) {
  const { from, sdp } = message;

  if (!peers.has(from)) {
    return;
  }

  // 优化接收的Answer的SDP，强制使用H264
  const optimizedSdp = forceH264Encoding(sdp);
  
  const peerData = peers.get(from);
  const sessionDesc = new RTCSessionDescription({ type: "answer", sdp: optimizedSdp });
  await peerData.pc.setRemoteDescription(sessionDesc);
}

async function handleIceCandidate(message) {
  const { from, candidate } = message;

  if (!peers.has(from)) {
    // 缓冲ICE候选
    if (!iceCandidateBuffers.has(from)) {
      iceCandidateBuffers.set(from, []);
    }
    iceCandidateBuffers.get(from).push(candidate);

    return;
  }

  const peerData = peers.get(from);
  if (peerData.pc) {
    await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function handleUserConnected(message) {
  const { userId: connectedUserId } = message;

  // 如果当前用户在共享，为新用户创建Offer
  if (isSharing && myStream) {
    createAndSendOffer(connectedUserId);
  }

  updateUserCount();
}

function handleUserDisconnected(message) {
  const { userId: disconnectedUserId } = message;

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
    const videoContainerId = "video-" + disconnectedUserId.substring(0, 8);
    const videoContainer = document.getElementById(videoContainerId);
    if (videoContainer) {
      // 添加消失动画
      videoContainer.style.opacity = "0";
      videoContainer.style.transition = "opacity 0.3s ease-out";
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
    // 如果当前用户不在共享，则为共享者创建连接
    if (!isSharing) {
      createAndSendOffer(sharerUserId);
    }
  }
}

function handleSharingStop(message) {
  const { userId: sharerUserId } = message;
  if (sharerUserId !== userId) {
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
      const videoContainerId = "video-" + sharerUserId.substring(0, 8);
      const videoContainer = document.getElementById(videoContainerId);
      if (videoContainer) {
        // 添加消失动画
        videoContainer.style.opacity = "0";
        videoContainer.style.transition = "opacity 0.3s ease-out";
        setTimeout(() => {
          if (videoContainer.parentNode) {
            videoContainer.remove();
          }
        }, 300);
      } else {
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
      { urls: "stun:stun.qq.com:3478" },
      { urls: "stun:stun.163.com:3478" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });

  // 如果当前用户在共享，添加本地流轨道
  if (isSharing && myStream) {
    myStream.getTracks().forEach((track) => {
      try {
        pc.addTrack(track, myStream);
      } catch (err) {
        console.error(`❌ 添加轨道失败 (${track.kind}): ${err.message}`);
      }
    });
  }

  // 处理远程轨道
  pc.ontrack = (event) => {
    const peerData = peers.get(remoteUserId);
    if (peerData) {
      const stream = event.streams[0];
      
      // 使用track的trackId而不是stream来进行去重，避免同一轨道多次处理
      const trackId = event.track.id;
      if (!peerData.processedTracks) {
        peerData.processedTracks = new Set();
      }
      
      // 如果已经处理过这个轨道，跳过
      if (peerData.processedTracks.has(trackId)) {
        console.log(`⏭️  跳过已处理的轨道: ${trackId.substring(0, 8)}`);
        return;
      }
      peerData.processedTracks.add(trackId);
      
      peerData.stream = stream;
      
      // 打印音频轨道信息
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      console.log(`📡 远程用户 ${remoteUserId.substring(0, 8)} 的流信息:`);
      console.log(`  📹 视频轨道: ${videoTracks.length} 个`);
      console.log(`  🎤 音频轨道: ${audioTracks.length} 个`);
      if (audioTracks.length > 0) {
        audioTracks.forEach((track, idx) => {
          console.log(`    [${idx}] ${track.label || '未命名'} (enabled: ${track.enabled})`);
        });
      } else {
        console.log(`    ⚠️  没有音频轨道`);
      }
      
      // 诊断视频轨道信息
      if (videoTracks.length > 0) {
        videoTracks.forEach((track, idx) => {
          // 视频编码参数在SDP协商后才能获取，延迟获取
          const settings = track.getSettings ? track.getSettings() : {};
          console.log(`    [视频${idx}] ${track.label || '未命名'} (received)`);
        });
      }

      // 如果视频元素还未创建，创建它
      if (!peerData.video) {
        const label = "共享屏幕 " + remoteUserId.substring(0, 8);
        peerData.video = createVideoElement(label, true);
        
        // 在视频加载完成后检查分辨率
        peerData.video.onloadedmetadata = () => {
          const videoTracks = stream.getVideoTracks();
          videoTracks.forEach((track, idx) => {
            const settings = track.getSettings ? track.getSettings() : {};
            if (settings.width && settings.height) {
              console.log(`    ✅ [视频${idx}] 分辨率已确定: ${settings.width}x${settings.height}`);
            }
          });
        };
      }

      // 只在还没有srcObject时才设置，避免重复赋值
      if (peerData.video.srcObject !== stream) {
        peerData.video.srcObject = stream;
      }

      // 确保视频开始播放（添加错误处理）
      // 使用Promise.catch而不是catch()来处理，并检查video的paused状态
      if (peerData.video.paused) {
        peerData.video.play()
          .catch((err) => {
            // "interrupted by new load request" 是正常的，不需要特别处理
            if (err.name === 'NotAllowedError' || err.name === 'NotSupportedError') {
              console.error(`❌ 视频播放失败: ${err.message}`);
            } else if (err.message && err.message.includes('interrupted')) {
              console.log(`⏸️  视频播放中被新的加载请求中断（正常现象）`);
            }
          });
      }
    }
  };

  // 处理ICE候选
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage({
        type: "ice-candidate",
        to: remoteUserId,
        candidate: event.candidate,
        roomId: roomId,
      });
    }
  };

  // 处理连接状态变化
  pc.onconnectionstatechange = () => {
    console.log(`🔗 连接状态 ${remoteUserId.substring(0, 8)}: ${pc.connectionState}`);
    
    // 仅在连接成功建立时诊断一次SDP信息，避免重复输出
    if (pc.connectionState === 'connected' && pc.remoteDescription && !pc._sdpLogged) {
      pc._sdpLogged = true;  // 标记已记录
      const remoteSdp = pc.remoteDescription.sdp;
      
      console.log(`\n📊 === 远程端(观看者)编码格式 ===`);
      const lines = remoteSdp.split('\n');
      let inVideoSection = false;
      
      for (const line of lines) {
        // 找video媒体线
        if (line.startsWith('m=video')) {
          inVideoSection = true;
          const parts = line.split(' ');
          const formats = parts.slice(3); // 获取所有PayloadType
          console.log(`📹 视频媒体行: ${line}`);
          console.log(`  支持的编码列表 (按优先级): ${formats.join(', ')}`);
        }
        // 获取编码详情
        else if (inVideoSection && line.startsWith('a=rtpmap:')) {
          console.log(`  ${line}`);
        }
        // 到下一个媒体段时停止
        else if (inVideoSection && line.startsWith('m=') && !line.startsWith('m=video')) {
          break;
        }
      }
      
      // 检查是否支持H264
      if (remoteSdp.includes('H264')) console.log(`  ✅ 支持 H264`);
      if (remoteSdp.includes('VP8')) console.log(`  ✅ 支持 VP8`);
      if (remoteSdp.includes('VP9')) console.log(`  ✅ 支持 VP9`);
      console.log(`\n`);
    }
  };

  return pc;
}

// ========== SDP 编码优化 ==========
// 将H264编码优先级提到最高以提高跨平台兼容性
function forceH264Encoding(sdp) {
  const lines = sdp.split('\n');
  const result = [];
  let h264PayloadType = null;
  
  // 第一遍：找到H264对应的PayloadType 
  for (const line of lines) {
    const rtpmapMatch = line.match(/a=rtpmap:(\d+)\s+H264/i);
    if (rtpmapMatch) {
      h264PayloadType = rtpmapMatch[1];
      console.log(`🎬 找到H264编码: PayloadType=${h264PayloadType}`);
      break;
    }
  }
  
  // 如果找不到H264，直接返回原SDP
  if (!h264PayloadType) {
    console.warn(`⚠️  未找到H264编码，保持原有编码格式`);
    return sdp;
  }
  
  // 第二遍：只修改video媒体行，将H264移到最前面
  let inVideoSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 检测视频媒体行
    if (line.startsWith('m=video')) {
      inVideoSection = true;
      // 修改格式列表，将H264的PayloadType移到最前面
      const parts = line.split(' ');
      const mediaLine = parts.slice(0, 3); // m=video 端口 proto
      const formats = parts.slice(3); // 所有PayloadType
      
      // 移除H264的PayloadType
      const h264Index = formats.indexOf(h264PayloadType);
      if (h264Index !== -1) {
        formats.splice(h264Index, 1);
        formats.unshift(h264PayloadType); // 放到最前面
        console.log(`✅ 设置H264为首选编码，优先级: ${formats.slice(0, 5).join(', ')}${formats.length > 5 ? ', ...' : ''}`);
      }
      
      result.push(mediaLine.join(' ') + ' ' + formats.join(' '));
    } else if (line.startsWith('m=') && !line.startsWith('m=video')) {
      inVideoSection = false;
      result.push(line);
    } else {
      result.push(line);
    }
  }
  
  return result.join('\n');
}

async function createAndSendOffer(remoteUserId) {
  if (!peers.has(remoteUserId)) {
    peers.set(remoteUserId, { pc: null, stream: null, video: null });
  }

  const peerData = peers.get(remoteUserId);

  // 如果已有活跃连接，跳过重复创建
  if (peerData.pc && peerData.pc.connectionState !== "closed") {
    return;
  }

  try {
    peerData.pc = createPeerConnection(remoteUserId);

    // 创建Offer并明确表示要接收视频和音频
    const offer = await peerData.pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: true,
    });
    
    // 打印本地(共享者)的编码格式
    console.log(`\n📊 === 本地端(共享者)编码格式 ===`);
    const lines = offer.sdp.split('\n');
    for (const line of lines) {
      if (line.startsWith('m=video')) {
        const parts = line.split(' ');
        const formats = parts.slice(3);
        console.log(`📹 视频媒体行: ${line}`);
        console.log(`  支持的编码列表 (按优先级): ${formats.join(', ')}`);
      } else if (line.startsWith('a=rtpmap:') && lines.indexOf(line) > lines.findIndex(l => l.startsWith('m=video'))) {
        console.log(`  ${line}`);
      }
    }
    console.log(`\n`);
    
    // 强制使用H264编码以提高跨平台兼容性（特别是MacBook Pro）
    const modifiedSdp = forceH264Encoding(offer.sdp);
    offer.sdp = modifiedSdp;
    
    await peerData.pc.setLocalDescription(offer);

    sendMessage({
      type: "offer",
      to: remoteUserId,
      sdp: offer.sdp,
      roomId: roomId,
    });
    
    console.log(`✅ 已向 ${remoteUserId.substring(0, 8)} 发送Offer (使用H264编码)`);
  } catch (error) {
    console.error(`❌ 创建Offer失败: ${error.message}`);
    showToast("创建Offer失败: " + error.message, "error");
  }
}

// ========== 工具函数 ==========
function createVideoElement(label, autoplay = false) {
  const container = document.createElement("div");
  container.className = "video-container";

  // 生成一致的ID：如果是自己的视频用'self'，否则用userId的前8个字符
  let containerId = "video-self";
  if (!label.includes("我")) {
    // 从标签中提取userId（"共享屏幕 xxxxx" -> "xxxxx"）
    const parts = label.split(" ");
    if (parts.length > 1) {
      containerId = "video-" + parts[1].substring(0, 8);
    }
  }
  container.id = containerId;

  const video = document.createElement("video");
  video.autoplay = autoplay;
  video.muted = autoplay;
  video.playsinline = true;

  const labelEl = document.createElement("div");
  labelEl.className = "video-label";
  labelEl.textContent = label;

  // 创建最大化按钮
  const maximizeBtn = document.createElement("button");
  maximizeBtn.className = "maximize-btn";
  maximizeBtn.innerHTML = '<img src="icons/max.svg" alt="最大化">';
  maximizeBtn.setAttribute("data-tooltip", "最大化");
  maximizeBtn.style.cssText = `
        position: absolute;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        border-radius: 4px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
    `;

  // 为图标添加样式
  maximizeBtn.querySelector("img").style.cssText = `
        width: 20px;
        height: 20px;
        object-fit: contain;
        filter: brightness(0) invert(1);
    `;

  maximizeBtn.addEventListener("mouseenter", () => {
    maximizeBtn.style.background = "rgba(0, 0, 0, 0.9)";
  });

  maximizeBtn.addEventListener("mouseleave", () => {
    maximizeBtn.style.background = "rgba(0, 0, 0, 0.7)";
  });

  maximizeBtn.addEventListener("click", () => {
    toggleMaximize(container);
  });

  container.appendChild(video);
  container.appendChild(labelEl);
  container.appendChild(maximizeBtn);
  videoGrid.appendChild(container);

  return video;
}

// 最大化/恢复视频容器
function toggleMaximize(container) {
  const isMaximized = container.classList.contains("maximized");

  if (isMaximized) {
    // 恢复原状
    container.classList.remove("maximized");
    container.style.cssText = "";

    // 显示所有视频容器
    const allContainers = document.querySelectorAll(".video-container");
    allContainers.forEach((c) => {
      c.style.display = "block";
    });

    // 恢复视频网格布局
    videoGrid.style.cssText = "";

    // 恢复最大化按钮的属性和样式
    const maximizeBtn = container.querySelector(".maximize-btn");
    if (maximizeBtn) {
      maximizeBtn.innerHTML = '<img src="icons/max.svg" alt="最大化">';
      maximizeBtn.setAttribute("data-tooltip", "最大化");
      maximizeBtn.style.cssText = `
        position: absolute;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        border-radius: 4px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
      `;

      // 为图标添加样式
      maximizeBtn.querySelector("img").style.cssText = `
        width: 20px;
        height: 20px;
        object-fit: contain;
        filter: brightness(0) invert(1);
      `;
    }
  } else {
    // 最大化当前容器
    container.classList.add("maximized");

    // 隐藏其他视频容器
    const allContainers = document.querySelectorAll(".video-container");
    allContainers.forEach((c) => {
      if (c !== container) {
        c.style.display = "none";
      }
    });

    // 设置当前容器为全屏样式
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 1000;
      border-radius: 0;
      margin: 0;
    `;

    // 调整视频网格以容纳最大化容器
    videoGrid.style.cssText = `
      position: relative;
      height: 100vh;
      overflow: hidden;
    `;

    // 调整最大化按钮位置和样式
    const maximizeBtn = container.querySelector(".maximize-btn");
    if (maximizeBtn) {
      maximizeBtn.innerHTML = '<img src="icons/max.svg" alt="恢复">';
      maximizeBtn.setAttribute("data-tooltip", "恢复");
      maximizeBtn.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        border-radius: 4px;
        width: 40px;
        height: 40px;
        cursor: pointer;
        z-index: 1001;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
      `;

      // 为最大化状态下的图标添加样式
      maximizeBtn.querySelector("img").style.cssText = `
        width: 25px;
        height: 25px;
        object-fit: contain;
        filter: brightness(0) invert(1);
      `;
    }
  }
}

function updateUserCount() {
  const count = peers.size + 1; // 加上自己
  if (userCountEl) userCountEl.textContent = count;
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.className = "toast show " + type;

  setTimeout(() => {
    toast.classList.remove("show");
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
    myStream.getTracks().forEach((track) => track.stop());
    myStream = null;
  }

  // 关闭WebSocket连接
  if (ws) {
    ws.close();
  }

  // 关闭当前标签页
  window.close();
}

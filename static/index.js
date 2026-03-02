// ========== 创建房间逻辑 ==========
const roomNameInput = document.getElementById('roomName');
const createBtn = document.getElementById('createBtn');
const toast = document.getElementById('toast');

createBtn.addEventListener('click', createRoom);

// 回车键创建房间
roomNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createRoom();
    }
});

function createRoom() {
    const roomName = roomNameInput.value.trim();
    
    if (!roomName) {
        showToast('请输入房间名称', 'error');
        return;
    }
    
    if (roomName.length < 2) {
        showToast('房间名称至少2个字符', 'error');
        return;
    }
    
    // 生成房间ID（使用房间名称）
    const roomId = encodeURIComponent(roomName);
    
    // 跳转到房间页面
    window.location.href = `room.html?room=${roomId}`;
}

function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

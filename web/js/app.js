// 八字TD - 前端交互逻辑

const API_BASE = '';

// 通用请求
async function request(url, options = {}) {
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
        },
        ...options,
    });

    const data = await res.json().catch(() => ({}));
    showResponse(data);
    return { status: res.status, data };
}

// 显示最近响应
function showResponse(data) {
    const el = document.getElementById('recent-response');
    el.textContent = JSON.stringify(data, null, 2);
}

// 健康检查
async function checkHealth() {
    const statusEl = document.getElementById('health-status');
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('span:not(.status-dot)');

    try {
        const { status, data } = await request(`${API_BASE}/api/health`);
        if (status === 200) {
            statusEl.classList.add('ok');
            text.textContent = '✅ 服务正常运行';
        } else {
            statusEl.classList.remove('ok');
            text.textContent = '⚠️ 服务异常';
        }
    } catch (err) {
        statusEl.classList.remove('ok');
        text.textContent = '❌ 无法连接';
    }
}

// 创建用户
async function createUser(e) {
    e.preventDefault();
    const name = document.getElementById('user-name').value;
    const email = document.getElementById('user-email').value;

    await request(`${API_BASE}/api/users`, {
        method: 'POST',
        body: JSON.stringify({ name, email }),
    });

    // 清空表单并刷新列表
    document.getElementById('create-form').reset();
    listUsers();
}

// 查询单个用户
async function getUser() {
    const id = document.getElementById('query-id').value;
    if (!id) {
        alert('请输入用户ID');
        return;
    }

    const { status, data } = await request(`${API_BASE}/api/users/${id}`);
    const resultEl = document.getElementById('query-result');

    if (status === 200 && data.data) {
        resultEl.textContent = `📋 ID: ${data.data.id}\n姓名: ${data.data.name}\n邮箱: ${data.data.email}\n创建时间: ${new Date(data.data.created_at).toLocaleString()}`;
    } else if (status === 404) {
        resultEl.textContent = '❌ 用户不存在';
    }
}

// 获取用户列表
async function listUsers() {
    const { status, data } = await request(`${API_BASE}/api/users`);
    const listEl = document.getElementById('user-list');

    if (status !== 200 || !data.data) {
        listEl.innerHTML = '<p class="empty">无法获取用户列表</p>';
        return;
    }

    const users = data.data;
    if (users.length === 0) {
        listEl.innerHTML = '<p class="empty">暂无用户，点击上方"创建"添加</p>';
        return;
    }

    listEl.innerHTML = users.map(u => `
        <div class="user-item">
            <div class="user-info">
                <span class="name">${escapeHtml(u.name)}</span>
                <span class="email">ID: ${u.id} · ${escapeHtml(u.email)}</span>
            </div>
            <div class="user-actions">
                <button class="btn btn-danger" onclick="deleteUser(${u.id})">删除</button>
            </div>
        </div>
    `).join('');
}

// 删除用户
async function deleteUser(id) {
    if (!confirm(`确定删除用户 #${id} 吗？`)) return;

    await request(`${API_BASE}/api/users/${id}`, {
        method: 'DELETE',
    });

    listUsers();
}

// HTML 转义
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 页面加载时自动检查健康状态
document.addEventListener('DOMContentLoaded', () => {
    checkHealth();
    listUsers();
});

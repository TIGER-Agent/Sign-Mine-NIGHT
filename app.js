// app.js (v4.2 - Robust Version)

document.addEventListener('DOMContentLoaded', () => {
    console.log('[App] DOM loaded. Initializing...');

    // === DOM Element Selection ===
    const connectBtn = document.getElementById('connectBtn');
    const signBtn = document.getElementById('signBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const statusMessage = document.getElementById('statusMessage');
    const ownerAddressEl = document.getElementById('ownerAddress');
    const jsonOutputContainer = document.querySelector('.output-container');
    const jsonOutputEl = document.getElementById('jsonOutput');

    // === State Management ===
    let walletApi = null;
    let stakeAddress = null;

    // === Helper Functions ===
    const utf8StringToHex = (str) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
    };

    const showStatus = (message, type = 'info') => {
        statusMessage.textContent = message;
        statusMessage.className = `status ${type}`;
        console.log(`[Status] ${type.toUpperCase()}: ${message}`);
    };

    const updateUIState = (state) => {
        console.log(`[App] Switching to state: ${state}`);
        
        // Hiển thị/ẩn các nút dựa trên trạng thái
        connectBtn.classList.toggle('hidden', state !== 'initial');
        signBtn.classList.toggle('hidden', state !== 'connected');
        disconnectBtn.classList.toggle('hidden', state !== 'connected');
        
        // Quản lý trạng thái disabled một cách rõ ràng
        if (state === 'initial') {
            connectBtn.disabled = false; // Đảm bảo nút kết nối luôn bật khi ở trạng thái ban đầu
            ownerAddressEl.textContent = 'Chưa kết nối';
            jsonOutputContainer.classList.add('hidden');
            jsonOutputEl.textContent = '';
        } else if (state === 'connecting') {
            connectBtn.disabled = true; // Khóa nút khi đang kết nối
            showStatus('Đang kết nối...', 'info');
            jsonOutputContainer.classList.add('hidden');
        } else if (state === 'connected') {
            signBtn.disabled = false;
            disconnectBtn.disabled = false;
        } else if (state === 'signing') {
            signBtn.disabled = true;
            disconnectBtn.disabled = true;
            showStatus('Đang chờ người dùng ký...', 'info');
        }
    };

    const resetState = (reason = '') => {
        walletApi = null;
        stakeAddress = null;
        updateUIState('initial');
        if (reason) {
            showStatus(`${reason} Đã ngắt kết nối.`, 'info');
        } else {
             // Kiểm tra xem ví đã sẵn sàng chưa để hiển thị thông báo phù hợp
             if (typeof window.cardano === 'undefined') {
                 showStatus('Không tìm thấy ví Cardano. Hãy đảm bảo bạn đã cài extension.', 'error');
             } else {
                 showStatus('Sẵn sàng kết nối.', 'info');
             }
        }
    };

    // === Core Logic Handlers ===

    const handleConnect = async () => {
        console.log('[Action] Connect button clicked');
        
        // Kiểm tra lại sự tồn tại của ví ngay thời điểm bấm nút
        if (typeof window.cardano === 'undefined') {
            showStatus('Lỗi: Không tìm thấy extension ví Cardano. Vui lòng tải lại trang sau khi cài đặt.', 'error');
            return;
        }

        updateUIState('connecting');

        try {
            // Tìm ví tương thích (ưu tiên ví đầu tiên tìm thấy có hàm enable)
            const walletName = Object.keys(window.cardano).find(key => 
                typeof window.cardano[key].enable === 'function' && key !== 'enable'
            );

            if (!walletName) {
                 throw new Error('Không tìm thấy ví tương thích (Yoroi, Nami, Eternl, v.v).');
            }

            console.log(`[App] Attempting to connect to wallet: ${walletName}`);
            walletApi = await window.cardano[walletName].enable();
            console.log('[App] Wallet enabled successfully');
            
            // --- EVENT LISTENERS SETUP ---
            // Chỉ thiết lập nếu API hỗ trợ
            if (walletApi.onAccountChange) walletApi.onAccountChange(() => resetState('Tài khoản ví đã thay đổi.'));
            if (walletApi.onNetworkChange) walletApi.onNetworkChange(() => resetState('Mạng ví đã thay đổi.'));

            // --- VALIDATION ---
            const rewardAddresses = await walletApi.getRewardAddresses();
            if (!rewardAddresses || rewardAddresses.length === 0) throw new Error('Ví chưa có địa chỉ stake.');
            stakeAddress = rewardAddresses[0];

            const unusedAddresses = await walletApi.getUnusedAddresses();
             if (!unusedAddresses || unusedAddresses.length === 0) throw new Error('Không tìm thấy địa chỉ chưa sử dụng.');

            // --- SUCCESS ---
            ownerAddressEl.textContent = stakeAddress;
            updateUIState('connected');
            showStatus('Kết nối ví thành công!', 'success');

        } catch (error) {
            console.error('[Error] Connection failed:', error);
            showStatus(error.info || error.message || 'Kết nối thất bại.', 'error');
            resetState(); // Reset về ban đầu nếu lỗi
        }
    };

    const handleSign = async () => {
        console.log('[Action] Sign button clicked');
        if (!walletApi || !stakeAddress) {
            resetState('Lỗi trạng thái kết nối.');
            return;
        }

        updateUIState('signing');

        try {
            const freshUnusedAddresses = await walletApi.getUnusedAddresses();
            if (!freshUnusedAddresses || freshUnusedAddresses.length === 0) throw new Error('Không lấy được địa chỉ thanh toán.');
            const paymentAddress = freshUnusedAddresses[0];

            const nonceArray = new Uint32Array(1);
            window.crypto.getRandomValues(nonceArray);
            const nonce = `nonce-${nonceArray[0]}`;

            const originalPayload = `Xác thực cho hệ thống kiểm thử Sign-Mine-NIGHT với nonce: ${nonce}`;
            const hexPayload = utf8StringToHex(originalPayload);
            
            console.log('[App] Requesting signature from wallet...');
            const signedData = await walletApi.signData(paymentAddress, hexPayload);
            console.log('[App] Signature received');

            const resultJSON = {
                owner: stakeAddress,
                publicKey: signedData.key,
                signature: signedData.signature,
                originalPayload: originalPayload,
                payloadEncoding: "utf-8",
                paymentAddress: paymentAddress
            };
            
            jsonOutputEl.textContent = JSON.stringify(resultJSON, null, 2);
            jsonOutputContainer.classList.remove('hidden');
            showStatus('Ký dữ liệu thành công!', 'success');

        } catch (error) {
            console.error('[Error] Signing failed:', error);
            showStatus(error.info || error.message || 'Đã hủy ký dữ liệu.', 'error');
        } finally {
            if (walletApi) updateUIState('connected'); // Chỉ quay lại 'connected' nếu vẫn chưa bị reset
        }
    };

    // === Initialization ===
    // Gán sự kiện click
    connectBtn.addEventListener('click', handleConnect);
    signBtn.addEventListener('click', handleSign);
    disconnectBtn.addEventListener('click', () => resetState('Người dùng ngắt kết nối.'));

    // Khởi tạo trạng thái ban đầu
    resetState();
});
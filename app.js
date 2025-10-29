// app.js (v4.4 - Non-blocking Initialization Fix)

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
        connectBtn.classList.toggle('hidden', state !== 'initial');
        signBtn.classList.toggle('hidden', state !== 'connected');
        disconnectBtn.classList.toggle('hidden', state !== 'connected');
        
        if (state === 'initial') {
            connectBtn.disabled = false;
            ownerAddressEl.textContent = 'Chưa kết nối';
            jsonOutputContainer.classList.add('hidden');
            jsonOutputEl.textContent = '';
        } else if (state === 'connecting') {
            connectBtn.disabled = true;
            showStatus('Đang kết nối...', 'info');
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
             if (typeof window.cardano === 'undefined') {
                 showStatus('Chưa tìm thấy ví Cardano. Extension có thể đang tải...', 'info');
             } else {
                 showStatus('Sẵn sàng kết nối.', 'info');
             }
        }
    };

    // === Core Logic Handlers ===

    const handleConnect = async () => {
        console.log('[Action] Connect button clicked');
        if (typeof window.cardano === 'undefined') {
            showStatus('Lỗi: Không tìm thấy extension ví Cardano. Vui lòng cài đặt và tải lại trang.', 'error');
            return;
        }
        
        // --- FIX START ---
        // Kiểm tra thư viện serialization TẠI ĐÂY, ngay trước khi cần dùng.
        if (typeof window.cardano_serialization_lib === 'undefined') {
            showStatus('Lỗi: Không thể tải thư viện Cardano cần thiết. Vui lòng kiểm tra kết nối mạng và thử lại.', 'error');
            return;
        }
        const S = window.cardano_serialization_lib;
        // --- FIX END ---

        updateUIState('connecting');

        try {
            const walletName = Object.keys(window.cardano).find(key => 
                typeof window.cardano[key].enable === 'function' && key !== 'enable'
            );
            if (!walletName) throw new Error('Không tìm thấy ví tương thích.');
            
            walletApi = await window.cardano[walletName].enable();
            
            if (walletApi.onAccountChange) walletApi.onAccountChange(() => resetState('Tài khoản ví đã thay đổi.'));
            if (walletApi.onNetworkChange) walletApi.onNetworkChange(() => resetState('Mạng ví đã thay đổi.'));

            const networkId = await walletApi.getNetworkId();
            const usedAddresses = await walletApi.getUsedAddresses();
            if (!usedAddresses || usedAddresses.length === 0) throw new Error("Ví không có địa chỉ đã sử dụng (cần để lấy stake key).");

            // Lấy stake address từ một trong các địa chỉ đã sử dụng
            const firstUsedAddress = S.Address.from_bech32(usedAddresses[0]);
            const baseAddress = S.BaseAddress.from_address(firstUsedAddress);
            if (!baseAddress) throw new Error("Địa chỉ không phải là loại Base Address, không thể trích xuất stake key.");
            
            const stakeCred = baseAddress.stake_cred();
            const rewardAddress = S.RewardAddress.new(networkId, stakeCred);
            stakeAddress = rewardAddress.to_address().to_bech32();
            console.log(`[App] Converted stake address: ${stakeAddress}`);

            const unusedAddresses = await walletApi.getUnusedAddresses();
            if (!unusedAddresses || unusedAddresses.length === 0) throw new Error('Không tìm thấy địa chỉ chưa sử dụng.');

            ownerAddressEl.textContent = stakeAddress;
            updateUIState('connected');
            showStatus('Kết nối ví thành công!', 'success');

        } catch (error) {
            console.error('[Error] Connection failed:', error);
            showStatus(error.info || error.message || 'Kết nối thất bại.', 'error');
            resetState();
        }
    };

    const handleSign = async () => {
        // ... (Hàm này không thay đổi)
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
            
            const signedData = await walletApi.signData(paymentAddress, hexPayload);

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
            if (walletApi) updateUIState('connected');
        }
    };

    // === Initialization ===
    connectBtn.addEventListener('click', handleConnect);
    signBtn.addEventListener('click', handleSign);
    disconnectBtn.addEventListener('click', () => resetState('Người dùng ngắt kết nối.'));
    resetState();
});
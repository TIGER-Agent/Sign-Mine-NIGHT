// app.js (v4.5 - Final Address Fix & Unused Addresses Feature)

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
    const hexToBytes = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    
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
            showStatus('Lỗi: Không tìm thấy extension ví Cardano.', 'error');
            return;
        }
        
        if (typeof window.cardano_serialization_lib === 'undefined') {
            showStatus('Lỗi: Không thể tải thư viện Cardano. Vui lòng kiểm tra kết nối mạng.', 'error');
            return;
        }
        const S = window.cardano_serialization_lib;

        updateUIState('connecting');

        try {
            const walletName = Object.keys(window.cardano).find(key => 
                typeof window.cardano[key].enable === 'function' && key !== 'enable'
            );
            if (!walletName) throw new Error('Không tìm thấy ví tương thích.');
            
            walletApi = await window.cardano[walletName].enable();
            
            if (walletApi.onAccountChange) walletApi.onAccountChange(() => resetState('Tài khoản ví đã thay đổi.'));
            if (walletApi.onNetworkChange) walletApi.onNetworkChange(() => resetState('Mạng ví đã thay đổi.'));

            // --- FIX START: Correct Stake Address Decoding ---
            const rawRewardAddresses = await walletApi.getRewardAddresses();
            if (!rawRewardAddresses || rawRewardAddresses.length === 0) throw new Error("Ví không trả về địa chỉ stake (reward address).");

            const stakeHex = rawRewardAddresses[0];
            const rewardAddressBytes = hexToBytes(stakeHex);
            const rewardAddress = S.RewardAddress.from_address(S.Address.from_bytes(rewardAddressBytes));
            
            if (!rewardAddress) throw new Error("Không thể giải mã địa chỉ stake từ ví.");

            stakeAddress = rewardAddress.to_address().to_bech32();
            console.log(`[App] Correctly decoded stake address: ${stakeAddress}`);
            // --- FIX END ---

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
        console.log('[Action] Sign button clicked');
        if (!walletApi || !stakeAddress) {
            resetState('Lỗi trạng thái kết nối.');
            return;
        }
        updateUIState('signing');
        try {
            // --- FEATURE START: Fetch Unused Addresses for JSON output ---
            const freshUnusedAddresses = await walletApi.getUnusedAddresses();
            if (!freshUnusedAddresses || freshUnusedAddresses.length === 0) throw new Error('Không lấy được địa chỉ thanh toán.');
            const paymentAddress = freshUnusedAddresses[0];
            // --- FEATURE END ---

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
                paymentAddress: paymentAddress,
                // --- FEATURE START: Add unused addresses to the output ---
                unusedAddresses: freshUnusedAddresses
                // --- FEATURE END ---
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
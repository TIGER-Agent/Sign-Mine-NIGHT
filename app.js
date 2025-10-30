// app.js (v6.0 - ES Module & WASM Ready)

// Import thư viện như một module. 'S' là viết tắt của Serialization.
import * as S from './libs/cardano_serialization_lib.js';

// Toàn bộ logic được đặt trong một hàm async để đảm bảo thư viện đã sẵn sàng.
const main = async () => {
    console.log('[App] Module loaded. Initializing...');
    
    // DOM Element Selection
    const connectBtn = document.getElementById('connectBtn');
    const signBtn = document.getElementById('signBtn');
    // ... (các element khác)
    const disconnectBtn = document.getElementById('disconnectBtn');
    const statusMessage = document.getElementById('statusMessage');
    const ownerAddressEl = document.getElementById('ownerAddress');
    const jsonContainer = document.getElementById('jsonContainer');
    const jsonOutputEl = document.getElementById('jsonOutput');
    const pasteContainer = document.getElementById('pasteContainer');
    const pasteDataOutputEl = document.getElementById('pasteDataOutput');

    // State Management
    let walletApi = null;
    let stakeAddress = null;

    // Helper Functions
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
            jsonContainer.classList.add('hidden');
            pasteContainer.classList.add('hidden');
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
        if (reason) showStatus(`${reason} Đã ngắt kết nối.`, 'info');
        else showStatus(typeof window.cardano === 'undefined' ? 'Chưa tìm thấy ví Cardano...' : 'Sẵn sàng kết nối.', 'info');
    };

    // Core Logic Handlers
    const handleConnect = async () => {
        console.log('[Action] Connect button clicked');
        if (typeof window.cardano === 'undefined') {
            showStatus('Lỗi: Không tìm thấy extension ví Cardano.', 'error');
            return;
        }

        updateUIState('connecting');
        try {
            const walletName = Object.keys(window.cardano).find(key => typeof window.cardano[key].enable === 'function' && key !== 'enable');
            if (!walletName) throw new Error('Không tìm thấy ví tương thích.');
            
            walletApi = await window.cardano[walletName].enable();
            
            if (walletApi.onAccountChange) walletApi.onAccountChange(() => resetState('Tài khoản ví đã thay đổi.'));
            if (walletApi.onNetworkChange) walletApi.onNetworkChange(() => resetState('Mạng ví đã thay đổi.'));

            const rawRewardAddresses = await walletApi.getRewardAddresses();
            if (!rawRewardAddresses || rawRewardAddresses.length === 0) throw new Error("Ví không trả về địa chỉ stake.");

            const stakeHex = rawRewardAddresses[0];
            const rewardAddressBytes = hexToBytes(stakeHex);
            const rewardAddress = S.RewardAddress.from_bytes(rewardAddressBytes);
            if (!rewardAddress) throw new Error("Không thể giải mã địa chỉ stake từ ví.");
            
            stakeAddress = rewardAddress.to_address().to_bech32();
            console.log(`[App] Correctly decoded stake address: ${stakeAddress}`);

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
            const freshUnusedAddresses = await walletApi.getUnusedAddresses();
            if (!freshUnusedAddresses || freshUnusedAddresses.length === 0) throw new Error('Không lấy được địa chỉ thanh toán.');
            const paymentAddress = freshUnusedAddresses[0];
            
            const nonceArray = new Uint32Array(1);
            window.crypto.getRandomValues(nonceArray);
            const nonce = `nonce-${nonceArray[0]}`;
            const originalPayload = `Xác thực cho hệ thống kiểm thử Sign-Mine-NIGHT với nonce: ${nonce}`;
            const hexPayload = utf8StringToHex(originalPayload);
            
            const signedData = await walletApi.signData(paymentAddress, hexPayload);

            const resultData = {
                owner: stakeAddress,
                publicKey: signedData.key,
                signature: signedData.signature,
                paymentAddress: paymentAddress
            };
            
            jsonOutputEl.textContent = JSON.stringify({ ...resultData, unusedAddresses: freshUnusedAddresses }, null, 2);
            jsonContainer.classList.remove('hidden');

            const pasteString = [resultData.owner, resultData.publicKey, '', resultData.signature, resultData.paymentAddress].join('\t');
            pasteDataOutputEl.value = pasteString;
            pasteContainer.classList.remove('hidden');
            
            showStatus('Ký dữ liệu thành công! Bạn có thể sao chép dữ liệu bên dưới.', 'success');

        } catch (error) {
            console.error('[Error] Signing failed:', error);
            showStatus(error.info || error.message || 'Đã hủy ký dữ liệu.', 'error');
        } finally {
            if (walletApi) updateUIState('connected');
        }
    };

    // Initialization
    connectBtn.addEventListener('click', handleConnect);
    signBtn.addEventListener('click', handleSign);
    disconnectBtn.addEventListener('click', () => resetState('Người dùng ngắt kết nối.'));
    resetState();
};

// Chạy hàm main để khởi động ứng dụng.
main();
// app.js (v6.1 - DOM Ready Fix)

// Import thư viện như một module. 'S' là viết tắt của Serialization.
import * as S from './libs/cardano_serialization_lib.js';

// Toàn bộ logic được đặt trong một hàm async để đảm bảo thư viện đã sẵn sàng.
const main = async () => {
    console.log('[App] DOM is ready. Initializing application logic...');
    
    // DOM Element Selection
    const connectBtn = document.getElementById('connectBtn');
    const signBtn = document.getElementById('signBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const statusMessage = document.getElementById('statusMessage');
    const ownerAddressEl = document.getElementById('ownerAddress');
    const jsonContainer = document.getElementById('jsonContainer');
    const jsonOutputEl = document.getElementById('jsonOutput');
    const pasteContainer = document.getElementById('pasteContainer');
    const pasteDataOutputEl = document.getElementById('pasteDataOutput');

    // State Management
    let walletApi = null;
    let stakeAddress = null;

    // Helper Functions
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
            jsonContainer.classList.add('hidden');
            pasteContainer.classList.add('hidden');
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
        if (reason) showStatus(`${reason} Đã ngắt kết nối.`, 'info');
        else showStatus(typeof window.cardano === 'undefined' ? 'Chưa tìm thấy ví Cardano...' : 'Sẵn sàng kết nối.', 'info');
    };

    // Core Logic Handlers
    const handleConnect = async () => {
        console.log('[Action] Connect button clicked');
        if (typeof window.cardano === 'undefined') {
            showStatus('Lỗi: Không tìm thấy extension ví Cardano.', 'error');
            return;
        }

        updateUIState('connecting');
        try {
            const walletName = Object.keys(window.cardano).find(key => typeof window.cardano[key].enable === 'function' && key !== 'enable');
            if (!walletName) throw new Error('Không tìm thấy ví tương thích.');
            
            walletApi = await window.cardano[walletName].enable();
            
            if (walletApi.onAccountChange) walletApi.onAccountChange(() => resetState('Tài khoản ví đã thay đổi.'));
            if (walletApi.onNetworkChange) walletApi.onNetworkChange(() => resetState('Mạng ví đã thay đổi.'));

            const rawRewardAddresses = await walletApi.getRewardAddresses();
            if (!rawRewardAddresses || rawRewardAddresses.length === 0) throw new Error("Ví không trả về địa chỉ stake.");

            const stakeHex = rawRewardAddresses[0];
            const rewardAddressBytes = hexToBytes(stakeHex);
            const rewardAddress = S.RewardAddress.from_bytes(rewardAddressBytes);
            if (!rewardAddress) throw new Error("Không thể giải mã địa chỉ stake từ ví.");
            
            stakeAddress = rewardAddress.to_address().to_bech32();
            console.log(`[App] Correctly decoded stake address: ${stakeAddress}`);

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
            const freshUnusedAddresses = await walletApi.getUnusedAddresses();
            if (!freshUnusedAddresses || freshUnusedAddresses.length === 0) throw new Error('Không lấy được địa chỉ thanh toán.');
            const paymentAddress = freshUnusedAddresses[0];
            
            const nonceArray = new Uint32Array(1);
            window.crypto.getRandomValues(nonceArray);
            const nonce = `nonce-${nonceArray[0]}`;
            const originalPayload = `Xác thực cho hệ thống kiểm thử Sign-Mine-NIGHT với nonce: ${nonce}`;
            const hexPayload = utf8StringToHex(originalPayload);
            
            const signedData = await walletApi.signData(paymentAddress, hexPayload);

            const resultData = {
                owner: stakeAddress,
                publicKey: signedData.key,
                signature: signedData.signature,
                paymentAddress: paymentAddress
            };
            
            jsonOutputEl.textContent = JSON.stringify({ ...resultData, unusedAddresses: freshUnusedAddresses }, null, 2);
            jsonContainer.classList.remove('hidden');

            const pasteString = [resultData.owner, resultData.publicKey, '', resultData.signature, resultData.paymentAddress].join('\t');
            pasteDataOutputEl.value = pasteString;
            pasteContainer.classList.remove('hidden');
            
            showStatus('Ký dữ liệu thành công! Bạn có thể sao chép dữ liệu bên dưới.', 'success');

        } catch (error) {
            console.error('[Error] Signing failed:', error);
            showStatus(error.info || error.message || 'Đã hủy ký dữ liệu.', 'error');
        } finally {
            if (walletApi) updateUIState('connected');
        }
    };

    // Initialization
    connectBtn.addEventListener('click', handleConnect);
    signBtn.addEventListener('click', handleSign);
    disconnectBtn.addEventListener('click', () => resetState('Người dùng ngắt kết nối.'));
    resetState();
};

// --- THAY ĐỔI QUAN TRỌNG ---
// Chỉ chạy hàm main SAU KHI toàn bộ trang HTML đã được tải và sẵn sàng.
document.addEventListener('DOMContentLoaded', () => {
    main();
});
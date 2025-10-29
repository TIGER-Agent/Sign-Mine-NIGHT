// app.js

document.addEventListener('DOMContentLoaded', () => {
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
    /**
     * Chuyển đổi chuỗi UTF-8 sang chuỗi Hex sử dụng TextEncoder.
     * Đây là phương pháp đáng tin cậy để đảm bảo mã hóa chính xác.
     * @param {string} str Chuỗi UTF-8 đầu vào.
     * @returns {string} Chuỗi Hex tương ứng.
     */
    const utf8StringToHex = (str) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
    };

    /**
     * Hiển thị thông báo trạng thái trên UI.
     * @param {string} message - Nội dung thông báo.
     * @param {'info' | 'success' | 'error'} type - Loại thông báo.
     */
    const showStatus = (message, type = 'info') => {
        statusMessage.textContent = message;
        statusMessage.className = `status ${type}`;
    };

    /**
     * Cập nhật giao diện dựa trên trạng thái ứng dụng.
     * @param {'initial' | 'connecting' | 'connected' | 'signing'} state 
     */
    const updateUIState = (state) => {
        connectBtn.classList.toggle('hidden', state !== 'initial');
        signBtn.classList.toggle('hidden', state !== 'connected');
        disconnectBtn.classList.toggle('hidden', state !== 'connected');
        
        signBtn.disabled = state === 'signing';
        disconnectBtn.disabled = state === 'signing';
        
        if (state === 'initial') {
            ownerAddressEl.textContent = 'Chưa kết nối';
            jsonOutputContainer.classList.add('hidden');
            jsonOutputEl.textContent = '';
        } else if (state === 'connecting' || state === 'signing') {
            const statusText = state === 'connecting' ? 'Đang kết nối...' : 'Đang chờ ký...';
            showStatus(statusText, 'info');
            jsonOutputContainer.classList.add('hidden');
        }
    };

    /**
     * Reset trạng thái ứng dụng về ban đầu.
     * Được gọi khi ngắt kết nối, đổi tài khoản, hoặc đổi mạng.
     */
    const resetState = (reason = '') => {
        walletApi = null;
        stakeAddress = null;
        updateUIState('initial');
        const message = reason ? `${reason} Đã ngắt kết nối.` : 'Sẵn sàng kết nối.';
        showStatus(message, 'info');
        console.log(`State reset triggered. Reason: ${reason || 'User action'}`);
    };

    // === Core Logic Handlers ===

    const handleConnect = async () => {
        if (typeof window.cardano === 'undefined') {
            showStatus('Lỗi: Không tìm thấy extension ví Cardano.', 'error');
            return;
        }

        updateUIState('connecting');

        try {
            const walletName = Object.keys(window.cardano).find(key => 
                typeof window.cardano[key].enable === 'function' && key !== 'enable'
            );

            if (!walletName) {
                throw new Error('Không tìm thấy ví tương thích nào.');
            }

            walletApi = await window.cardano[walletName].enable();
            
            // Validation 1: Kiểm tra địa chỉ Stake
            const rewardAddresses = await walletApi.getRewardAddresses();
            if (!rewardAddresses || rewardAddresses.length === 0) {
                throw new Error('Ví của bạn chưa đăng ký địa chỉ stake. Vui lòng kiểm tra lại.');
            }
            stakeAddress = rewardAddresses[0];

            // Validation 2: Kiểm tra địa chỉ chưa sử dụng
            const unusedAddresses = await walletApi.getUnusedAddresses();
            if (!unusedAddresses || unusedAddresses.length === 0) {
                 throw new Error('Không tìm thấy địa chỉ chưa sử dụng. Vui lòng tạo địa chỉ mới trong ví.');
            }

            // Cập nhật giao diện thành công
            ownerAddressEl.textContent = stakeAddress;
            updateUIState('connected');
            showStatus('Kết nối ví thành công!', 'success');

        } catch (error) {
            console.error('Lỗi kết nối ví:', error);
            showStatus(error.info || error.message || 'Yêu cầu kết nối bị từ chối.', 'error');
            resetState();
        }
    };

    const handleSign = async () => {
        if (!walletApi || !stakeAddress) {
            resetState('Lỗi trạng thái không hợp lệ.');
            return;
        }

        updateUIState('signing');

        try {
            // (Quan trọng) Lấy lại địa chỉ mới nhất để giảm thiểu race condition
            const freshUnusedAddresses = await walletApi.getUnusedAddresses();
            if (!freshUnusedAddresses || freshUnusedAddresses.length === 0) {
                throw new Error('Không lấy được địa chỉ thanh toán mới nhất.');
            }
            const paymentAddress = freshUnusedAddresses[0];

            // Tạo Nonce an toàn
            const nonceArray = new Uint32Array(1);
            window.crypto.getRandomValues(nonceArray);
            const nonce = `nonce-${nonceArray[0]}`;

            // Tạo và mã hóa Payload
            const originalPayload = `Xác thực cho hệ thống kiểm thử Sign-Mine-NIGHT với nonce: ${nonce}`;
            const hexPayload = utf8StringToHex(originalPayload);
            
            // Yêu cầu ký
            const signedData = await walletApi.signData(paymentAddress, hexPayload);

            // Xử lý và xuất kết quả
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
            console.error('Lỗi khi ký dữ liệu:', error);
            showStatus(error.info || error.message || 'Yêu cầu ký đã bị hủy.', 'error');
        } finally {
            updateUIState('connected'); // Quay lại trạng thái đã kết nối dù thành công hay thất bại
        }
    };

    /**
     * Khởi tạo ứng dụng: kiểm tra ví và thiết lập các trình lắng nghe sự kiện.
     */
    const initialize = () => {
        if (typeof window.cardano !== 'undefined') {
            // Lắng nghe sự kiện thay đổi tài khoản hoặc mạng
            window.cardano.onAccountChange(() => resetState('Tài khoản ví đã thay đổi.'));
            window.cardano.onNetworkChange(() => resetState('Mạng ví đã thay đổi.'));
        } else {
            showStatus('Vui lòng cài đặt một ví Cardano (ví dụ: Yoroi, Eternl).', 'error');
            connectBtn.disabled = true;
        }
        
        connectBtn.addEventListener('click', handleConnect);
        signBtn.addEventListener('click', handleSign);
        disconnectBtn.addEventListener('click', () => resetState('Người dùng ngắt kết nối.'));

        resetState(); // Bắt đầu ở trạng thái ban đầu
    };

    // Khởi chạy ứng dụng
    initialize();
});
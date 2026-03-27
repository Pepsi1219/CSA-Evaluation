// --- 1. Global Variables ---
let startTime; 
let elapsedTime = 0; 
let timerInterval;
let isRunning = false;

// --- 2. Stopwatch Functions (Optimized) ---
function startStop() {
    const btn = document.getElementById('startStopBtn');
    if (!isRunning) {
        isRunning = true;
        btn.innerText = "Stop";
        btn.classList.add('btn-stop-active'); // ใช้ Class แทนการเขียน Style โดยตรง
        btn.classList.remove('btn-start-active');
        
        startTime = Date.now() - elapsedTime;
        // ปรับเป็น 100ms ก็เพียงพอสำหรับการโชว์มิลลิวินาที 2 หลัก ช่วยลดภาระ CPU
        timerInterval = setInterval(updateDisplay, 10); 
    } else {
        isRunning = false;
        btn.innerText = "Continue";
        btn.classList.add('btn-start-active');
        btn.classList.remove('btn-stop-active');
        clearInterval(timerInterval);
    }
}

function updateDisplay() {
    elapsedTime = Date.now() - startTime;
    const totalSeconds = Math.floor(elapsedTime / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const millis = Math.floor((elapsedTime % 1000) / 10);

    document.getElementById('display').innerText = 
        `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${millis.toString().padStart(2, '0')}`;
}

function resetTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    elapsedTime = 0;
    document.getElementById('display').innerText = "00:00:00";
    const btn = document.getElementById('startStopBtn');
    btn.innerText = "Start";
    btn.classList.add('btn-start-active');
    btn.classList.remove('btn-stop-active');

    ['totalMin', 'totalTime', 'totalCount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
}

function recordTime() {
    const totalSeconds = Math.floor(elapsedTime / 1000);
    document.getElementById('totalMin').value = Math.floor(totalSeconds / 60);
    document.getElementById('totalTime').value = totalSeconds % 60;
    calculateAll();
}

// --- 3. Language & Navigation ---
const translations = {
    'th': {
        // ส่วนที่ 1: การตั้งเป้าหมาย
        'header1': '1. การตั้งเป้าหมาย',
        'sam_label': 'ค่า SAM (นาที)',
        'eff_target': 'เป้าหมายประสิทธิภาพ (%)',
        'qty_label': 'เป้าหมายชิ้นงาน (ชิ้น/ชม.)',

        // ส่วนที่ 2: บันทึกผลงานจริง
        'header2': '2. บันทึกผลงานจริง',
        'total_min': 'เวลารวมทั้งหมด (นาที)',
        'total_sec': 'เวลารวมทั้งหมด (วินาที)',
        'total_count': 'จำนวนครั้งที่ทำได้ (รอบ)',
        'avg_timesec': 'เวลาต่อรอบจริง (วินาที)',
        'avg_timemin': 'เวลาต่อรอบจริง (นาที)',
        'actual_eff': 'ประสิทธิภาพจริง (%)',
        'actual_pcs': 'ประสิทธิภาพจริง (ชิ้น/ชม.)',

        // ส่วนที่ 3: คุณภาพ
        'header3': '3. คุณภาพ',
        'pass_qty': 'จำนวนที่ "ผ่าน" (ชิ้น)',
        'fail_qty': 'จำนวนที่ "ไม่ผ่าน" (ชิ้น)',
        'pass_rate': 'อัตราการผ่าน (%)',
      
         // ส่วนที่ 4: วางแผนการฝึก
        'header4': '4. วางแผนการฝึก',
        'training_duration': 'ระยะเวลาการฝึก (วัน/ชม)'
    },
    'en': {
        'header1': '1. Set Target',
        'sam_label': 'SAM Value (Minutes)',
        'eff_target': 'Target Efficiency (%)',
        'qty_label': 'Target Cut Piece (pcs/hrs.)',

        'header2': '2. Record Actual Results',
        'total_min': 'Total Time (Minutes)',
        'total_sec': 'Total Time (Seconds)',
        'total_count': 'Total Cycles (Rounds)',
        'avg_timesec': 'Actual Cycle Time (Seconds)',
        'avg_timemin': 'Actual Cycle Time (Minutes)',
        'actual_eff': 'Actual Efficiency (%)',
        'actual_pcs': 'Actual Efficiency (Pieces/Hour)',

        'header3': '3. Quality',
        'pass_qty': 'Passed Qty (Pcs)',
        'fail_qty': 'Failed Qty (Pcs)',
        'pass_rate': 'Pass rate (%)',
            
        'header4': '4. Training Plan',
        'training_duration': 'Training duration (days/hours)'
    },
    'vn': {
        'header1': '1. Thiết lập mục tiêu',
        'sam_label': 'Giá trị SAM (Phút)',
        'eff_target': 'Hiệu suất mục tiêu (%)',
        'qty_label': 'Số lượng sản phẩm mục tiêu mỗi giờ',

        'header2': '2. Ghi lại kết quả thực tế',
        'total_min': 'Tổng thời gian (Phút)',
        'total_sec': 'Tổng thời gian (Giây)',
        'total_count': 'Số lần (Vòng)',
        'avg_timesec': 'Thời gian vòng thực tế (Giây)',
        'avg_timemin': 'Thời gian vòng thực tế (Phút)',
        'actual_eff': 'Hiệu suất thực tế (%)',
        'actual_pcs': 'Hiệu suất thực tế (Sản phẩm/Giờ)',

        'header3': '3. Chất lượng',
        'pass_qty': 'Số lượng đạt tiêu chuẩn (Cái)',
        'fail_qty': 'Số lượng không đạt tiêu chuẩn (Cái)',
        'pass_rate': 'Tỷ lệ đậu (%)',
        
        'header4': '4. Kế hoạch đào tạo',
        'training_duration': 'Thời lượng đào tạo (ngày/giờ)'
    },
    'la': {
        'header1': '1. ການກຳນົດເປົ້າໝາຍ',
        'sam_label': 'ຄ່າ SAM (ນາທີ)',
        'eff_target': 'ເປົ້າໝາຍການປະຕິບັດ (%)',
        'qty_label': 'ຈຳນວນເປົ້າໝາຍຂອງຊິ້ນສ່ວນຕໍ່ຊົ່ວໂມງ',

        'header2': '2. ບັນທຶກຜົນໄດ້ຮັບຕົວຈິງ',
        'total_min': 'ເວລາທັງໝົດ (ນາທີ)',
        'total_sec': 'ເວລາທັງໝົດ (ວິນາທີ)',
        'total_count': 'ຈຳນວນເທື່ອ (ຮອບ)',
        'avg_timesec': 'ເວລາຮອບຕົວຈິງ (ວິນາທີ)',
        'avg_timemin': 'ເວລາຮອບຕົວຈິງ (ນາທີ)',
        'actual_eff': 'ປະສິດທິພາບຕົວຈິງ (%)',
        'actual_pcs': 'ປະສິດທິພາບຕົວຈິງ (ຊິ້ນ/ຊົ່ວໂມງ)',

        'header3': '3. ຄຸນນະພາບ',
        'pass_qty': 'ຈຳນວນຜະລິດຕະພັນທີ່ໄດ້ມາດຕະຖານ (ຊິ້ນ)',
        'fail_qty': 'ຈຳນວນຜະລິດຕະພັນທີ່ບໍ່ໄດ້ມາດຕະຖານ (ຊິ້ນ)',
        'pass_rate': 'ອັດຕາການຜ່ານ (%)',
        
        'header4': '4. ແຜນການຝຶກອົບຮົມ',
        'training_duration': 'ໄລຍະເວລາການຝຶກອົບຮົມ (ມື້/ຊົ່ວໂມງ)'
    }
};

function changeLanguage(lang) {
    document.querySelectorAll('.lang-text').forEach(el => {
        const key = el.getAttribute('data-key');
        if (translations[lang]?.[key]) el.innerText = translations[lang][key];
    });
}

function scrollToBottom() {
    document.getElementById('header4')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
    ['samInput', 'effTargetInput', 'totalMin', 'totalTime', 'totalCount', 'passQty', 'failQty', 'duration'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    calculateAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- 4. Core Calculation (Optimized) ---
function calculateAll() {
    const getValue = id => parseFloat(document.getElementById(id).value) || 0;
    
    const sam = getValue('samInput');
    const effTarget = getValue('effTargetInput');
    const totalMin = getValue('totalMin');
    const totalTime = getValue('totalTime');
    const totalCount = getValue('totalCount');
    const passQty = getValue('passQty');
    const failQty = getValue('failQty');
    const duration = getValue('duration');

    // 1. Target
    const targetDisplay = document.getElementById('targetDisplay');
    if (sam > 0 && effTarget > 0) {
        targetDisplay.value = Math.ceil((60 / sam) * (effTarget / 100));
    } else targetDisplay.value = "";

    // 2. Actual
    let currentActualEff = 0;
    if (totalCount > 0 && (totalMin > 0 || totalTime > 0)) {
        const avgMin = ((totalMin * 60) + totalTime) / totalCount / 60;
        document.getElementById('avgTimeSec').value = Math.ceil(avgMin * 60);
        document.getElementById('avgTimeMin').value = avgMin.toFixed(2);
        
        if (sam > 0) {
            currentActualEff = Math.ceil((sam / avgMin) * 100);
            document.getElementById('actualEffPerc').value = `${currentActualEff} %`;
            document.getElementById('actualPcs').value = `${Math.ceil(60 / avgMin)} ชิ้น`;
        }
    }

    // 3. Quality
    const totalQty = passQty + failQty;
    document.getElementById('passRate').value = totalQty > 0 ? `${Math.ceil((passQty / totalQty) * 100)} %` : "";

    // 4. Training Plan
    const gap = effTarget - currentActualEff;
    for (let i = 1; i <= 18; i++) {
        const el = document.getElementById(`d${i}`);
        if (!el) continue;
        
        if (duration > 0 && gap > 0 && i <= duration) {
            const dayEff = Math.ceil(currentActualEff + (gap / duration * i));
            const dayPcs = sam > 0 ? Math.ceil((60 / sam) * (dayEff / 100)) : 0;
            el.value = `${dayEff}% ➡️ ${dayPcs}`;
        } else {
            el.value = "";
        }
    }
}

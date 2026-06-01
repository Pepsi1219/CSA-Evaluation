// ============================================================
// GOOGLE FORMS CONFIG  (Task 0.4)
// ============================================================
// ขั้นตอนการตั้งค่า:
//   1. ไปที่ https://forms.google.com → สร้าง Form ใหม่
//   2. เพิ่ม 3 คำถาม: Rating (Short answer), Message (Paragraph), Email (Short answer)
//   3. เปิด Form preview → F12 → Network tab → กรอก+Submit → ดู POST request
//   4. copy URL (ลงท้าย /formResponse) และ entry.XXXXXXX ของแต่ละช่อง
//   5. วางค่าด้านล่าง แล้วเปลี่ยน GFORM_ENABLED เป็น true
// ============================================================
const GFORM = {
    url:   'https://docs.google.com/forms/u/0/d/e/1FAIpQLSeK5EJHXXDH7wk9B9Y3tkEH_YN-pIgekLlzoVRdHNCNf4UaGw/formResponse',
    entry: {
        rating:  'entry.450855868',
        message: 'entry.1453433683',
        email:   'entry.32399215',
    }
};
const GFORM_ENABLED = true;

// ============================================================
// CONFIG
// ============================================================
const MAX_TRAINING_DAYS = 18;

// --- 1. Global State ---
let startTime;
let elapsedTime = 0;
let timerInterval;
let isRunning = false;
let currentLang = 'th';

// --- 2. Stopwatch ---
function startStop() {
    const btn = document.getElementById('startStopBtn');
    if (!isRunning) {
        isRunning = true;
        btn.innerText = "Stop";
        btn.classList.add('btn-stop-active');
        btn.classList.remove('btn-start-active');
        startTime = Date.now() - elapsedTime;
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
    const mins   = Math.floor(totalSeconds / 60);
    const secs   = totalSeconds % 60;
    const millis = Math.floor((elapsedTime % 1000) / 10);
    document.getElementById('display').innerText =
        `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}:${millis.toString().padStart(2,'0')}`;
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
    calculateAll();
}

function recordTime() {
    const totalSeconds = Math.floor(elapsedTime / 1000);
    document.getElementById('totalMin').value  = Math.floor(totalSeconds / 60);
    document.getElementById('totalTime').value = totalSeconds % 60;
    calculateAll();
}

// --- 3. Translations ---
const translations = {
    'th': {
        'brand_sub': 'เครื่องมือประเมินประสิทธิภาพ',
        'header1': 'การตั้งเป้าหมาย',
        'sam_label': 'ค่า SAM (นาที)',
        'eff_target': 'เป้าหมายประสิทธิภาพ (%)',
        'qty_label': 'เป้าหมายชิ้นงาน (ชิ้น/ชม.)',

        'header2': 'บันทึกผลงานจริง',
        'total_min': 'เวลารวม (นาที)',
        'total_sec': 'เวลารวม (วินาที)',
        'total_count': 'จำนวน (รอบ)',
        'avg_timesec': 'เวลาต่อรอบ (วินาที)',
        'avg_timemin': 'เวลาต่อรอบ (นาที)',
        'actual_eff': 'ประสิทธิภาพจริง (%)',
        'actual_pcs': 'ประสิทธิภาพจริง (ชิ้น/ชม.)',

        'header3': 'คุณภาพ',
        'pass_qty': 'จำนวนที่ "ผ่าน" (ชิ้น)',
        'fail_qty': 'จำนวนที่ "ไม่ผ่าน" (ชิ้น)',
        'pass_rate': 'อัตราการผ่าน (%)',

        'header4': 'วางแผนการฝึก',
        'training_duration': 'ระยะเวลาการฝึก (วัน/ชม)',
        'day_unit': 'วัน/ชม.ที่',

        'feedback_btn': 'Feedback',
        'feedback_title': 'ส่งความคิดเห็น',
        'feedback_subtitle': 'เรายินดีรับฟังความคิดเห็นของคุณ',
        'feedback_rating': 'ระดับความพึงพอใจ',
        'feedback_message': 'ข้อความเสนอแนะ',
        'feedback_contact': 'ข้อมูลติดต่อกลับ (ไม่บังคับ)',
        'cancel': 'ยกเลิก',
        'send': 'ส่งความคิดเห็น',
        'feedback_required': 'กรุณากรอกข้อความเสนอแนะ',
        'feedback_thanks': '✅ ขอบคุณสำหรับความคิดเห็น!',
    },
    'en': {
        'brand_sub': 'Performance Evaluation Tool',
        'header1': 'Set Target',
        'sam_label': 'SAM Value (Minutes)',
        'eff_target': 'Target Efficiency (%)',
        'qty_label': 'Target Cut Piece (pcs/hrs.)',

        'header2': 'Record Actual Results',
        'total_min': 'Total Time (Min)',
        'total_sec': 'Total Time (Sec)',
        'total_count': 'Count (Rounds)',
        'avg_timesec': 'Cycle Time (Sec)',
        'avg_timemin': 'Cycle Time (Min)',
        'actual_eff': 'Actual Efficiency (%)',
        'actual_pcs': 'Actual Efficiency (pcs/hr.)',

        'header3': 'Quality',
        'pass_qty': 'Passed Qty (Pcs)',
        'fail_qty': 'Failed Qty (Pcs)',
        'pass_rate': 'Pass Rate (%)',

        'header4': 'Training Plan',
        'training_duration': 'Training Duration (Days/Hrs)',
        'day_unit': 'Day/Hr.',

        'feedback_btn': 'Feedback',
        'feedback_title': 'Send Feedback',
        'feedback_subtitle': "We'd love to hear from you",
        'feedback_rating': 'Satisfaction Rating',
        'feedback_message': 'Suggestions',
        'feedback_contact': 'Contact Info (Optional)',
        'cancel': 'Cancel',
        'send': 'Send Feedback',
        'feedback_required': 'Please enter your feedback',
        'feedback_thanks': '✅ Thank you for your feedback!',
    },
    'vn': {
        'brand_sub': 'Công cụ đánh giá hiệu suất',
        'header1': 'Thiết lập mục tiêu',
        'sam_label': 'Giá trị SAM (Phút)',
        'eff_target': 'Hiệu suất mục tiêu (%)',
        'qty_label': 'Số lượng sản phẩm mục tiêu mỗi giờ',

        'header2': 'Ghi lại kết quả thực tế',
        'total_min': 'Tổng thời gian (Phút)',
        'total_sec': 'Tổng thời gian (Giây)',
        'total_count': 'Số lần (Vòng)',
        'avg_timesec': 'Thời gian vòng (Giây)',
        'avg_timemin': 'Thời gian vòng (Phút)',
        'actual_eff': 'Hiệu suất thực tế (%)',
        'actual_pcs': 'Hiệu suất thực tế (SP/Giờ)',

        'header3': 'Chất lượng',
        'pass_qty': 'Số lượng đạt (Cái)',
        'fail_qty': 'Số lượng không đạt (Cái)',
        'pass_rate': 'Tỷ lệ đạt (%)',

        'header4': 'Kế hoạch đào tạo',
        'training_duration': 'Thời lượng đào tạo (ngày/giờ)',
        'day_unit': 'Ngày/Giờ',

        'feedback_btn': 'Phản hồi',
        'feedback_title': 'Gửi phản hồi',
        'feedback_subtitle': 'Chúng tôi rất vui được lắng nghe ý kiến của bạn',
        'feedback_rating': 'Mức độ hài lòng',
        'feedback_message': 'Đề xuất',
        'feedback_contact': 'Thông tin liên hệ (Không bắt buộc)',
        'cancel': 'Hủy',
        'send': 'Gửi phản hồi',
        'feedback_required': 'Vui lòng nhập phản hồi của bạn',
        'feedback_thanks': '✅ Cảm ơn phản hồi của bạn!',
    },
    'la': {
        'brand_sub': 'ເຄື່ອງມືປະເມີນປະສິດທິພາບ',
        'header1': 'ການກຳນົດເປົ້າໝາຍ',
        'sam_label': 'ຄ່າ SAM (ນາທີ)',
        'eff_target': 'ເປົ້າໝາຍການປະຕິບັດ (%)',
        'qty_label': 'ຈຳນວນເປົ້າໝາຍຂອງຊິ້ນສ່ວນຕໍ່ຊົ່ວໂມງ',

        'header2': 'ບັນທຶກຜົນໄດ້ຮັບຕົວຈິງ',
        'total_min': 'ເວລາທັງໝົດ (ນາທີ)',
        'total_sec': 'ເວລາທັງໝົດ (ວິນາທີ)',
        'total_count': 'ຈຳນວນເທື່ອ (ຮອບ)',
        'avg_timesec': 'ເວລາຮອບ (ວິນາທີ)',
        'avg_timemin': 'ເວລາຮອບ (ນາທີ)',
        'actual_eff': 'ປະສິດທິພາບຕົວຈິງ (%)',
        'actual_pcs': 'ປະສິດທິພາບຕົວຈິງ (ຊິ້ນ/ຊມ.)',

        'header3': 'ຄຸນນະພາບ',
        'pass_qty': 'ຈຳນວນທີ່ໄດ້ມາດຕະຖານ (ຊິ້ນ)',
        'fail_qty': 'ຈຳນວນທີ່ບໍ່ໄດ້ມາດຕະຖານ (ຊິ້ນ)',
        'pass_rate': 'ອັດຕາການຜ່ານ (%)',

        'header4': 'ແຜນການຝຶກອົບຮົມ',
        'training_duration': 'ໄລຍະເວລາການຝຶກ (ມື້/ຊມ)',
        'day_unit': 'ມື້/ຊມ.',

        'feedback_btn': 'ຄໍາຄິດເຫັນ',
        'feedback_title': 'ສົ່ງຄໍາຄິດເຫັນ',
        'feedback_subtitle': 'ພວກເຮົາຍິນດີຮັບຟັງຄໍາຄິດເຫັນຂອງທ່ານ',
        'feedback_rating': 'ລະດັບຄວາມພໍໃຈ',
        'feedback_message': 'ຂໍ້ສະເໜີ',
        'feedback_contact': 'ຂໍ້ມູນຕິດຕໍ່ (ບໍ່ບັງຄັບ)',
        'cancel': 'ຍົກເລີກ',
        'send': 'ສົ່ງຄໍາຄິດເຫັນ',
        'feedback_required': 'ກະລຸນາໃສ່ຄໍາຄິດເຫັນ',
        'feedback_thanks': '✅ ຂອບໃຈສຳລັບຄໍາຄິດເຫັນ!',
    }
};

const LANG_META = {
    th: { flag: '🇹🇭', name: 'ไทย' },
    en: { flag: '🇺🇸', name: 'English' },
    vn: { flag: '🇻🇳', name: 'Tiếng Việt' },
    la: { flag: '🇱🇦', name: 'ລາວ' },
};

const pcsUnit = { th: 'ชิ้น', en: 'pcs', vn: 'cái', la: 'ຊິ້ນ' };

const t = key => translations[currentLang]?.[key] ?? translations.th[key] ?? key;

// --- 4. Training Grid Generator ---
function generateTrainingGrid() {
    const grid = document.getElementById('trainingGrid');
    if (!grid) return;
    let html = '';
    for (let i = 1; i <= MAX_TRAINING_DAYS; i++) {
        html += `
        <div class="day-card" id="dayCard${i}">
            <label class="day-label">${t('day_unit')} ${i}</label>
            <input type="text" id="d${i}" readonly class="glass-input glass-input-day">
        </div>`;
    }
    grid.innerHTML = html;
}

// --- 5. Language ---
function changeLanguage(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    document.documentElement.lang = lang;

    // body content
    document.querySelectorAll('.lang-text').forEach(el => {
        const key = el.getAttribute('data-key');
        if (translations[lang][key]) el.innerText = translations[lang][key];
    });

    // training day labels (generated dynamically)
    document.querySelectorAll('.day-label').forEach((el, idx) => {
        el.innerText = `${t('day_unit')} ${idx + 1}`;
    });

    // dropdown trigger + active state
    document.getElementById('currentFlag').innerText = LANG_META[lang].flag;
    document.getElementById('currentLangName').innerText = LANG_META[lang].name;
    document.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === lang);
    });

    closeLangMenu();
    calculateAll(); // refresh pcs unit
}

function toggleLangMenu() {
    const sel = document.getElementById('langSelector');
    const open = sel.classList.toggle('open');
    document.getElementById('langTrigger').setAttribute('aria-expanded', open);
}
function closeLangMenu() {
    const sel = document.getElementById('langSelector');
    sel?.classList.remove('open');
    document.getElementById('langTrigger')?.setAttribute('aria-expanded', 'false');
}

function resetForm() {
    ['samInput','effTargetInput','passQty','failQty','duration'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    resetTimer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- 6. Core Calculation ---
function calculateAll() {
    const getValue = id => parseFloat(document.getElementById(id).value) || 0;

    const sam        = getValue('samInput');
    const effTarget  = getValue('effTargetInput');
    const totalMin   = getValue('totalMin');
    const totalTime  = getValue('totalTime');
    const totalCount = getValue('totalCount');
    const passQty    = getValue('passQty');
    const failQty    = getValue('failQty');
    const duration   = getValue('duration');

    // 1. Target
    const targetDisplay = document.getElementById('targetDisplay');
    targetDisplay.value = (sam > 0 && effTarget > 0)
        ? Math.ceil((60 / sam) * (effTarget / 100))
        : "";

    // 2. Actual
    let currentActualEff = 0;
    if (totalCount > 0 && (totalMin > 0 || totalTime > 0)) {
        const avgMin = ((totalMin * 60) + totalTime) / totalCount / 60;
        document.getElementById('avgTimeSec').value = Math.ceil(avgMin * 60);
        document.getElementById('avgTimeMin').value = avgMin.toFixed(2);
        if (sam > 0) {
            currentActualEff = Math.ceil((sam / avgMin) * 100);
            document.getElementById('actualEffPerc').value = `${currentActualEff} %`;
            document.getElementById('actualPcs').value = `${Math.ceil(60 / avgMin)} ${pcsUnit[currentLang] || 'pcs'}`;
        } else {
            document.getElementById('actualEffPerc').value = '';
            document.getElementById('actualPcs').value = '';
        }
    } else {
        ['avgTimeSec','avgTimeMin','actualEffPerc','actualPcs'].forEach(id => {
            document.getElementById(id).value = '';
        });
    }

    // 3. Quality
    const totalQty = passQty + failQty;
    document.getElementById('passRate').value =
        totalQty > 0 ? `${Math.ceil((passQty / totalQty) * 100)} %` : "";

    // 4. Training Plan
    const gap = effTarget - currentActualEff;
    for (let i = 1; i <= MAX_TRAINING_DAYS; i++) {
        const el = document.getElementById(`d${i}`);
        const card = document.getElementById(`dayCard${i}`);
        if (!el) continue;
        if (duration > 0 && gap > 0 && i <= duration) {
            const dayEff = Math.ceil(currentActualEff + (gap / duration * i));
            const dayPcs = sam > 0 ? Math.ceil((60 / sam) * (dayEff / 100)) : 0;
            el.value = `${dayEff}% · ${dayPcs}`;
            card?.classList.add('filled');
        } else {
            el.value = "";
            card?.classList.remove('filled');
        }
    }
}

// --- 7. Google Forms Integration ---
async function sendToGoogleForms(rating, message, email) {
    const body = new URLSearchParams({
        [GFORM.entry.rating]:  String(rating || '-'),
        [GFORM.entry.message]: message,
        [GFORM.entry.email]:   email || '-',
    });
    await fetch(GFORM.url, { method: 'POST', mode: 'no-cors', body });
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 8. Feedback Modal ---
const feedbackModal     = document.getElementById('feedbackModal');
const feedbackBtn       = document.getElementById('feedbackBtn');
const closeModalBtn     = document.getElementById('closeModalBtn');
const cancelFeedbackBtn = document.getElementById('cancelFeedbackBtn');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');

let currentRating = 0;
const stars = document.querySelectorAll('.star');

stars.forEach(star => {
    star.addEventListener('click', () => {
        currentRating = parseInt(star.dataset.rating);
        document.getElementById('ratingValue').value = currentRating;
        stars.forEach((s, i) => s.classList.toggle('active', i < currentRating));
    });
});

function openFeedbackModal() {
    feedbackModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}
function closeFeedbackModal() {
    feedbackModal.style.display = 'none';
    document.body.style.overflow = '';
    resetFormFeedback();
}
function resetFormFeedback() {
    currentRating = 0;
    stars.forEach(s => s.classList.remove('active'));
    document.getElementById('ratingValue').value  = '';
    document.getElementById('feedbackMessage').value = '';
    document.getElementById('feedbackEmail').value   = '';
}

async function submitFeedback() {
    const rating  = document.getElementById('ratingValue').value;
    const message = document.getElementById('feedbackMessage').value.trim();
    const email   = document.getElementById('feedbackEmail').value.trim();

    if (!message) { alert(t('feedback_required')); return; }

    submitFeedbackBtn.disabled = true;
    submitFeedbackBtn.style.opacity = '0.6';
    const sendLabel = submitFeedbackBtn.querySelector('.lang-text');
    const originalText = sendLabel.innerText;
    sendLabel.innerText = '...';

    if (GFORM_ENABLED) {
        try { await sendToGoogleForms(rating, message, email); }
        catch (_) { /* no-cors: verify ไม่ได้ ถือว่าส่งแล้ว */ }
    }

    closeFeedbackModal();
    showToast(t('feedback_thanks'));

    submitFeedbackBtn.disabled = false;
    submitFeedbackBtn.style.opacity = '';
    sendLabel.innerText = originalText;
}

// --- 9. Event Wiring ---
feedbackBtn?.addEventListener('click', openFeedbackModal);
closeModalBtn?.addEventListener('click', closeFeedbackModal);
cancelFeedbackBtn?.addEventListener('click', closeFeedbackModal);
submitFeedbackBtn?.addEventListener('click', submitFeedback);

feedbackModal?.addEventListener('click', e => {
    if (e.target === feedbackModal) closeFeedbackModal();
});

document.getElementById('langTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleLangMenu();
});
document.querySelectorAll('.lang-option').forEach(opt => {
    opt.addEventListener('click', () => changeLanguage(opt.dataset.lang));
});
document.addEventListener('click', e => {
    if (!e.target.closest('#langSelector')) closeLangMenu();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (feedbackModal?.style.display === 'flex') closeFeedbackModal();
        closeLangMenu();
    }
});

// --- 10. Async Web Fonts (non-blocking; system font shows instantly) ---
function loadWebFonts() {
    const href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800'
               + '&family=Noto+Sans+Thai:wght@400;500;600;700;800'
               + '&family=Noto+Sans+Lao:wght@400;500;600;700&display=swap';
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

// --- 11. Init ---
generateTrainingGrid();
changeLanguage('th');
calculateAll();
if (document.readyState === 'complete') loadWebFonts();
else window.addEventListener('load', loadWebFonts);

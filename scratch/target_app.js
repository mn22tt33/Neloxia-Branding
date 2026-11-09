// Client application logic for QureoSolver.xyz

// --- Helper: Safe JSON Response Parser ---
async function parseJsonResponse(res, defaultMsg = 'حدث خطأ في معالجة استجابة الخادم') {
  let text = '';
  try {
    text = await res.text();
  } catch (e) {
    throw new Error('تعذر قراءة استجابة السيرفر. يرجى التحقق من اتصال الإنترنت.');
  }

  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    if (res.status === 504 || res.status === 524 || text.includes('524') || text.includes('timeout')) {
      throw new Error('استغرقت العملية وقتاً أطول من المعتاد بسبب ضغط السيرفر أو بطء المنصة. يرجى إعادة المحاولة بعد لحظات.');
    }
    if (res.status >= 500 || text.includes('502 Bad Gateway') || text.includes('503 Service')) {
      throw new Error(`السيرفر يواجه ضغطاً مؤقتاً (${res.status}). يرجى المحاولة بعد قليل.`);
    }
    if (res.status === 403 || text.includes('Cloudflare') || text.includes('Access denied')) {
      throw new Error('تم حظر الاتصال مؤقتاً بواسطة جدار الحماية. يرجى إعادة تحميل الصفحة والمحاولة مجدداً.');
    }
    throw new Error(defaultMsg + ` (${res.status})`);
  }

  return data;
}

// --- State Management ---
let currentStudent = null;
let currentCurriculumData = null;
let selectedChaptersSet = new Set();
let portalSettings = {
  price_per_chapter: 5,
  price_full_course: 100,
  free_trial_limit: 10
};

// --- Language Switcher ---
document.addEventListener('DOMContentLoaded', () => {
  const langToggleBtn = document.getElementById('langToggleBtn');
  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      const isArabic = document.documentElement.lang === 'ar';
      const newLang = isArabic ? 'en' : 'ar';
      document.cookie = `site_lang=${newLang}; path=/; max-age=31536000`;
      window.location.reload();
    });
  }

  initGradeSelector();
  initPortalLogin();
  initCheckoutPage();
  initGlobalOrderTracker();
});

// --- Dynamic Grade & Course Dropdown Mapping ---
function initGradeSelector() {
  const gradeSelect = document.getElementById('portalGrade');
  const courseSelect = document.getElementById('portalCourse');

  if (!gradeSelect || !courseSelect) return;

  const coursesByGrade = {
    g10: [
      { id: 'javascript_ar', name: '🔷 كيريو - البرمجة جافاسكريبت (الصف الأول الثانوي)' }
    ],
    g11: [
      { id: 'python_short_en', name: '🟢 كيريو - البرمجة بايثون (الصف الثاني الثانوي)' },
      { id: 'financial_literacy', name: '🔶 سبريكس - التثقيف المالي (الصف الثاني الثانوي)' }
    ]
  };

  const updateCourseOptions = () => {
    const selectedGrade = gradeSelect.value;
    const courses = coursesByGrade[selectedGrade] || coursesByGrade.g10;
    courseSelect.innerHTML = '';
    courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      courseSelect.appendChild(opt);
    });
  };

  gradeSelect.addEventListener('change', updateCourseOptions);

  // Check URL query parameters (e.g. /portal?grade=g11&course=python_short_en)
  const urlParams = new URLSearchParams(window.location.search);
  const qGrade = urlParams.get('grade');
  const qCourse = urlParams.get('course');
  if (qGrade && coursesByGrade[qGrade]) {
    gradeSelect.value = qGrade;
    updateCourseOptions();
    if (qCourse) courseSelect.value = qCourse;
  }
}

// --- Credential Sanitizer Helper ---
function sanitizeCredential(str, isId = false) {
  if (!str) return '';
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let clean = String(str)
    .replace(/[٠-٩]/g, d => arabicNumerals.indexOf(d))
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0\u3000\u0000-\u001F]/g, '')
    .trim();
  if (isId) {
    clean = clean.replace(/\s+/g, '');
  }
  return clean;
}

// --- Portal Login & Curriculum Loading ---
function initPortalLogin() {
  const form = document.getElementById('portalLoginForm');
  if (!form) return;

  const errBox = document.getElementById('loginErrorMsg');
  const loginBtn = document.getElementById('portalLoginBtn');
  const loginCard = document.getElementById('loginCard');
  const portalDashboard = document.getElementById('portalDashboard');

  // Password visibility toggle
  const togglePassBtn = document.getElementById('togglePasswordVisibility');
  const passInput = document.getElementById('portalPassword');
  const eyeIcon = document.getElementById('eyeIcon');
  if (togglePassBtn && passInput) {
    togglePassBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      if (eyeIcon) eyeIcon.textContent = isPass ? '🙈' : '👁️';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span>جارٍ فحص الحساب على المنصة...</span> <span class="animate-spin">⏳</span>';

    let studentId = sanitizeCredential(document.getElementById('portalStudentId').value, true);
    let password = sanitizeCredential(document.getElementById('portalPassword').value, false);
    const grade = document.getElementById('portalGrade').value;
    const course = document.getElementById('portalCourse').value;

    // Smart swap ONLY if student clearly pasted a password in studentId and an ID in password
    const looksLikeId = (val) => /^\d{7,12}$/.test(val);
    const looksLikePassword = (val) => /[a-zA-Z!@#$%^&*?_~]/.test(val) && !/^\d+$/.test(val);
    if (looksLikePassword(studentId) && looksLikeId(password)) {
      const temp = studentId;
      studentId = password;
      password = temp;
    }

    document.getElementById('portalStudentId').value = studentId;
    document.getElementById('portalPassword').value = password;

    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, password, grade, course })
      });
      const data = await parseJsonResponse(res, 'فشل الاتصال بالحساب');

      if (!data.success) {
        throw new Error(data.error || 'فشل الاتصال بالحساب');
      }

      const actualCourse = data.course || course;
      const actualGrade = data.grade || grade;
      currentStudent = { studentId, password, grade: actualGrade, course: actualCourse, info: data.studentInfo, hasUsedTrial: data.hasUsedTrial };
      currentCurriculumData = data.curriculum;
      portalSettings = { ...portalSettings, ...data.settings };

      // Save credentials in sessionStorage for checkout
      sessionStorage.setItem('qs_student', JSON.stringify(currentStudent));

      // Render dashboard view
      loginCard.classList.add('hidden');
      portalDashboard.classList.remove('hidden');
      renderPortalDashboard(data);

    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span>فحص الحساب وعرض المنهج</span> <span>🔍</span>';
    }
  });

  // Logout/Switch account button
  const logoutBtn = document.getElementById('logoutStudentBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('qs_student');
      currentStudent = null;
      portalDashboard.classList.add('hidden');
      loginCard.classList.remove('hidden');
    });
  }
}

// --- Render Portal Dashboard ---
function renderPortalDashboard(data) {
  const unit = data.curriculum?.[0] || { items: [] };
  const items = unit.items || [];
  const completed = items.filter(i => i.is_completed).length;
  const pct = items.length > 0 ? Math.round((completed / items.length) * 100) : 0;

  // Top summary
  document.getElementById('dashCourseTitle').textContent = unit.name || 'المنهج الدراسي';
  document.getElementById('dashStudentIdLabel').textContent = `طالب: ${currentStudent.studentId}`;
  document.getElementById('dashDiamondCount').textContent = `${unit.diamond || 0} / ${unit.total_diamonds || 210} 💎`;
  document.getElementById('dashProgressPct').textContent = `${pct}%`;
  document.getElementById('totalChaptersCountText').textContent = `${items.length} فصلاً (${completed} مكتمل)`;

  // Free trial button state
  const btnFreeTrial = document.getElementById('btnFreeTrial');
  const trialLimitText = document.getElementById('freeTrialLimitText');
  const trialLimit = data.settings?.free_trial_limit || (currentStudent.course === 'financial_literacy' ? 2 : 10);
  trialLimitText.textContent = trialLimit;

  // Grade 11 free trial is strictly for financial literacy only
  const isTrialAllowed = data.isTrialAllowed !== false && !(currentStudent.grade === 'g11' && currentStudent.course !== 'financial_literacy');

  if (!isTrialAllowed) {
    btnFreeTrial.classList.remove('bg-gradient-to-r', 'from-emerald-500', 'to-teal-500', 'text-slate-950');
    btnFreeTrial.classList.add('bg-slate-800', 'text-slate-400', 'cursor-not-allowed', 'border', 'border-slate-700');
    btnFreeTrial.disabled = true;
    btnFreeTrial.innerHTML = '<span>التجربة المجانية لتانية ثانوي متاحة للثقافة المالية فقط</span>';
  } else if (currentStudent.hasUsedTrial) {
    btnFreeTrial.classList.remove('bg-gradient-to-r', 'from-emerald-500', 'to-teal-500', 'text-slate-950');
    btnFreeTrial.classList.add('bg-slate-800', 'text-slate-500', 'cursor-not-allowed', 'border', 'border-slate-700');
    btnFreeTrial.disabled = true;
    btnFreeTrial.innerHTML = '<span>تم استهلاك التجربة المجانية ✓</span>';
  } else {
    btnFreeTrial.classList.remove('bg-slate-800', 'text-slate-400', 'text-slate-500', 'cursor-not-allowed', 'border', 'border-slate-700');
    btnFreeTrial.classList.add('bg-gradient-to-r', 'from-emerald-500', 'to-teal-500', 'text-slate-950');
    btnFreeTrial.disabled = false;
    btnFreeTrial.innerHTML = `<span>🚀 حل أول ${trialLimit} ${currentStudent.course === 'financial_literacy' ? 'أنشطة' : 'فصول'} مجاناً</span>`;
    btnFreeTrial.onclick = triggerFreeTrial;
  }

  // Full solve button
  document.getElementById('fullPriceText').textContent = data.settings?.price_full_course || 100;
  document.getElementById('btnSolveFull').onclick = () => {
    goToCheckout('full', []);
  };

  // Solve selected button
  document.getElementById('btnSolveSelected').onclick = () => {
    if (selectedChaptersSet.size === 0) {
      alert('يرجى تحديد فصل واحد على الأقل للحل!');
      return;
    }
    goToCheckout('per_chapter', Array.from(selectedChaptersSet));
  };

  // Render chapters grid
  const grid = document.getElementById('chaptersListGrid');
  grid.innerHTML = '';
  selectedChaptersSet.clear();

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = `p-3.5 rounded-xl border flex items-center justify-between transition-all ${
      item.is_completed 
        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-200'
    }`;

    const left = document.createElement('div');
    left.className = 'flex items-center gap-3';

    if (!item.is_completed) {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.value = item.id;
      chk.className = 'chapter-checkbox w-4 h-4 rounded';
      chk.addEventListener('change', () => {
        if (chk.checked) selectedChaptersSet.add(item.id);
        else selectedChaptersSet.delete(item.id);
        updateSelectionSummary();
      });
      left.appendChild(chk);
    } else {
      const checkIcon = document.createElement('span');
      checkIcon.textContent = '✓';
      checkIcon.className = 'w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center';
      left.appendChild(checkIcon);
    }

    const titleBox = document.createElement('div');
    titleBox.className = 'text-xs font-bold';
    titleBox.textContent = item.title;
    left.appendChild(titleBox);

    const right = document.createElement('div');
    right.className = 'text-xs font-mono font-bold';
    if (item.is_completed) {
      right.innerHTML = `<span class="text-amber-400">💎 ${item.diamond || 5}/5</span>`;
    } else {
      right.innerHTML = `<span class="text-slate-500">${portalSettings.price_per_chapter || 5} ج.م</span>`;
    }

    card.appendChild(left);
    card.appendChild(right);
    grid.appendChild(card);
  });

  // Select all unsolved helper
  const selectAll = document.getElementById('selectAllUnsolvedCheck');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.onchange = () => {
      const checkboxes = grid.querySelectorAll('.chapter-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = selectAll.checked;
        if (selectAll.checked) selectedChaptersSet.add(cb.value);
        else selectedChaptersSet.delete(cb.value);
      });
      updateSelectionSummary();
    };
  }

  updateSelectionSummary();
}

function updateSelectionSummary() {
  const count = selectedChaptersSet.size;
  const price = count * (portalSettings.price_per_chapter || 5);
  const countEl = document.getElementById('selectedCountText');
  const priceEl = document.getElementById('selectedPriceText');
  if (countEl) countEl.textContent = count;
  if (priceEl) priceEl.textContent = price;
}

// --- Trigger Free Trial ---
async function triggerFreeTrial() {
  if (!currentStudent) return;

  if (currentStudent.grade === 'g11' && currentStudent.course !== 'financial_literacy') {
    alert('التجربة المجانية للصف الثاني الثانوي متاحة فقط لمادة التثقيف المالي (سبريكس - SPRIX).');
    return;
  }

  const limitUnit = currentStudent.course === 'financial_literacy' ? 'أنشطة' : 'فصول';
  if (!confirm(`هل تريد بدء التجربة المجانية الآن لحل أول ${portalSettings.free_trial_limit || 2} ${limitUnit} لحسابك فورياً؟`)) return;

  const btn = document.getElementById('btnFreeTrial');
  btn.disabled = true;
  btn.innerHTML = '<span>جارٍ بدء التجربة...</span> <span class="animate-spin">⏳</span>';

  try {
    const res = await fetch('/api/trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: currentStudent.studentId,
        password: currentStudent.password,
        grade: currentStudent.grade,
        course: currentStudent.course
      })
    });
    const data = await parseJsonResponse(res, 'فشل بدء التجربة');
    if (!data.success) throw new Error(data.error || 'فشل بدء التجربة');

    try {
      localStorage.setItem('qureo_active_order', JSON.stringify({
        orderId: data.orderId,
        studentId: currentStudent.studentId,
        course: currentStudent.course,
        isTrial: true,
        createdAt: Date.now()
      }));
    } catch (_) {}

    window.location.href = `/order/${data.orderId}`;
  } catch (e) {
    alert(e.message);
    btn.disabled = false;
    btn.innerHTML = '<span>🚀 ابدأ التجربة المجانية</span>';
  }
}

// --- Navigate to Checkout ---
function goToCheckout(packageType, selectedChapters) {
  if (!currentStudent) {
    alert('يرجى تسجيل الدخول بحسابك أولاً');
    window.location.href = '/portal';
    return;
  }

  const orderDraft = {
    studentId: currentStudent.studentId,
    password: currentStudent.password,
    grade: currentStudent.grade,
    course: currentStudent.course,
    packageType,
    selectedChapters,
    totalPrice: packageType === 'full' 
      ? (currentStudent.course === 'financial_literacy' ? Number(portalSettings.price_full_sprix || portalSettings.price_full_course || 200) : Number(portalSettings.price_full_course || 100))
      : selectedChapters.length * Number(portalSettings.price_per_chapter || 5)
  };

  sessionStorage.setItem('qs_checkout_draft', JSON.stringify(orderDraft));
  window.location.href = '/checkout';
}

// --- Checkout Page Setup ---
function initCheckoutPage() {
  const form = document.getElementById('checkoutForm');
  if (!form) return;

  const draftStr = sessionStorage.getItem('qs_checkout_draft');
  if (!draftStr) {
    // If opened directly without draft, return to portal
    window.location.href = '/portal';
    return;
  }

  const draft = JSON.parse(draftStr);

  // Populate summary
  const courseNames = {
    javascript_ar: 'كيريو - البرمجة جافاسكريبت (أولى ثانوي)',
    python_short_en: 'كيريو - البرمجة بايثون (تانية ثانوي)',
    financial_literacy: 'سبريكس - التثقيف المالي (تانية ثانوي)'
  };

  document.getElementById('chkCourseName').textContent = courseNames[draft.course] || draft.course;
  document.getElementById('chkStudentId').textContent = draft.studentId;
  document.getElementById('chkPackageType').textContent = draft.packageType === 'full' 
    ? 'حل المنهج بالكامل (100% Diamonds)' 
    : `فصول محددة (${draft.selectedChapters?.length || 1} فصول)`;
  document.getElementById('chkTotalPrice').textContent = `${draft.totalPrice} ج.م`;

  // Referral Code Handling
  let appliedReferralCode = null;
  const referralInput = document.getElementById('chkReferralInput');
  const btnApplyRef = document.getElementById('btnApplyReferral');
  const refStatus = document.getElementById('referralStatusMsg');
  const origPriceRow = document.getElementById('originalPriceRow');
  const origPriceText = document.getElementById('chkOriginalPrice');
  const discRow = document.getElementById('discountPriceRow');
  const discText = document.getElementById('chkDiscountAmount');
  const totalPriceText = document.getElementById('chkTotalPrice');

  // Unique Reference Memo Code for this checkout
  let currentRefCode = sessionStorage.getItem('qs_checkout_ref');
  if (!currentRefCode) {
    currentRefCode = 'QS-' + Math.floor(1000 + Math.random() * 9000);
    sessionStorage.setItem('qs_checkout_ref', currentRefCode);
  }
  const refCodeEl = document.getElementById('transferRefCode');
  if (refCodeEl) refCodeEl.textContent = currentRefCode;

  // 100% Free Discount UI elements
  const freeCouponAlert = document.getElementById('freeCouponAlert');
  const paymentMethodsSec = document.getElementById('paymentMethodsSection');
  const transferMemoSec = document.getElementById('transferMemoSection');
  const paymentMethodSec = document.getElementById('paymentMethodSection');
  const senderInfoSec = document.getElementById('senderInfoSection');
  const receiptUploadSec = document.getElementById('receiptUploadSection');
  const antiFraudSec = document.getElementById('antiFraudSection');
  const submitBtn = document.getElementById('submitPaymentBtn');

  let activeTotal = draft.totalPrice;

  function updateCouponUI(is100Free) {
    if (is100Free) {
      if (freeCouponAlert) freeCouponAlert.classList.remove('hidden');
      if (paymentMethodsSec) paymentMethodsSec.classList.add('hidden');
      if (transferMemoSec) transferMemoSec.classList.add('hidden');
      if (paymentMethodSec) paymentMethodSec.classList.add('hidden');
      if (senderInfoSec) senderInfoSec.classList.add('hidden');
      if (receiptUploadSec) receiptUploadSec.classList.add('hidden');
      if (antiFraudSec) antiFraudSec.classList.add('hidden');
      const fileInp = document.getElementById('receiptFileInput');
      if (fileInp) fileInp.removeAttribute('required');
      const nameInp = document.getElementById('chkSenderName');
      const phoneInp = document.getElementById('chkSenderPhone');
      if (nameInp) nameInp.removeAttribute('required');
      if (phoneInp) phoneInp.removeAttribute('required');
      if (submitBtn) submitBtn.innerHTML = '<span>🚀 ابدأ الحل التلقائي فوراً مجاناً (خصم 100%)</span> <span>←</span>';
    } else {
      if (freeCouponAlert) freeCouponAlert.classList.add('hidden');
      if (paymentMethodsSec) paymentMethodsSec.classList.remove('hidden');
      if (transferMemoSec) transferMemoSec.classList.remove('hidden');
      if (paymentMethodSec) paymentMethodSec.classList.remove('hidden');
      if (senderInfoSec) senderInfoSec.classList.remove('hidden');
      if (receiptUploadSec) receiptUploadSec.classList.remove('hidden');
      if (antiFraudSec) antiFraudSec.classList.remove('hidden');
      const fileInp = document.getElementById('receiptFileInput');
      if (fileInp) fileInp.setAttribute('required', 'required');
      const nameInp = document.getElementById('chkSenderName');
      const phoneInp = document.getElementById('chkSenderPhone');
      if (nameInp) nameInp.setAttribute('required', 'required');
      if (phoneInp) phoneInp.setAttribute('required', 'required');
      if (submitBtn) submitBtn.innerHTML = '<span>تأكيد التحويل وإرسال الطلب</span> <span>✓</span>';
    }
  }

  if (btnApplyRef) {
    btnApplyRef.addEventListener('click', async () => {
      const code = referralInput.value.trim().toUpperCase();
      if (!code) {
        alert('يرجى إدخال كود الخصم أولاً');
        return;
      }

      btnApplyRef.disabled = true;
      btnApplyRef.textContent = 'تحقق...';
      refStatus.className = 'text-[11px] font-bold mt-2 text-slate-400';
      refStatus.textContent = 'جارٍ التحقق من صلاحية الكود...';
      refStatus.classList.remove('hidden');

      try {
        const res = await fetch(`/api/referral/${encodeURIComponent(code)}`);
        const data = await parseJsonResponse(res, 'فشل فحص كود الخصم');

        if (data.success) {
          appliedReferralCode = data.code;
          const discountPct = parseFloat(data.discountPct) || 10;
          const discountVal = Math.round((draft.totalPrice * (discountPct / 100)) * 100) / 100;
          activeTotal = Math.max(0, draft.totalPrice - discountVal);

          origPriceText.textContent = `${draft.totalPrice} ج.م`;
          discText.textContent = `-${discountVal} ج.م (كود: ${data.code})`;
          totalPriceText.textContent = `${activeTotal} ج.م`;

          origPriceRow.classList.remove('hidden');
          discRow.classList.remove('hidden');

          const is100Free = activeTotal === 0 || discountPct >= 100;
          updateCouponUI(is100Free);

          refStatus.className = 'text-[11px] font-bold mt-2 text-emerald-400';
          if (is100Free) {
            refStatus.textContent = `🎉 تم تفعيل كود الخصم [${data.code}] بنجاح! خصم 100% كامل مجاناً وبدء الحل الفوري دون مراجعة.`;
          } else {
            refStatus.textContent = `✅ تم تفعيل كود الخصم [${data.code}] بنجاح! وفرت ${discountVal} ج.م (${discountPct}% خصم)`;
          }
          btnApplyRef.textContent = 'مفعّل ✓';
          btnApplyRef.classList.add('bg-emerald-600/30', 'text-emerald-300');
        } else {
          throw new Error(data.error || 'كود غير صحيح');
        }
      } catch (err) {
        refStatus.className = 'text-[11px] font-bold mt-2 text-rose-400';
        refStatus.textContent = `❌ ${err.message}`;
        btnApplyRef.disabled = false;
        btnApplyRef.textContent = 'تطبيق الكود';
        appliedReferralCode = null;
        activeTotal = draft.totalPrice;
        updateCouponUI(false);
      }
    });
  }

  // Helper: compress image client-side before upload to prevent slow mobile timeouts
  async function compressReceiptImage(file) {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
      return file;
    }

    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const MAX_DIM = 1600;
              let width = img.width;
              let height = img.height;

              if (width > MAX_DIM || height > MAX_DIM) {
                if (width > height) {
                  height = Math.round((height * MAX_DIM) / width);
                  width = MAX_DIM;
                } else {
                  width = Math.round((width * MAX_DIM) / height);
                  height = MAX_DIM;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, width, height);

              canvas.toBlob((blob) => {
                if (blob && (blob.size < file.size || file.size > 2 * 1024 * 1024)) {
                  const compressedFile = new File([blob], (file.name || 'receipt').replace(/\.[^/.]+$/, '') + '.jpg', {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                  });
                  resolve(compressedFile);
                } else {
                  resolve(file);
                }
              }, 'image/jpeg', 0.82);
            } catch (canvasErr) {
              console.warn('Canvas compression error:', canvasErr);
              resolve(file);
            }
          };
          img.onerror = () => resolve(file);
          img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
      } catch (err) {
        console.warn('FileReader error:', err);
        resolve(file);
      }
    });
  }

  // Receipt File Preview
  const fileInput = document.getElementById('receiptFileInput');
  const previewContainer = document.getElementById('imagePreviewContainer');
  const previewImg = document.getElementById('imagePreview');
  const promptBox = document.getElementById('uploadPrompt');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        if (file.size > 30 * 1024 * 1024) {
          alert('حجم الصورة كبير جداً! الحد الأقصى هو 30 ميجابايت.');
          fileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          previewImg.src = e.target.result;
          promptBox.classList.add('hidden');
          previewContainer.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Submit Payment
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitPaymentBtn');
    const errBox = document.getElementById('checkoutErrorMsg');

    const isFreeOrder = activeTotal === 0 && appliedReferralCode;

    let senderName = '';
    let senderPhone = '';
    let paymentMethod = 'instapay';

    if (!isFreeOrder) {
      senderName = document.getElementById('chkSenderName')?.value?.trim() || '';
      if (!senderName || senderName.length < 3) {
        alert('⚠️ يرجى كتابة اسم صاحب الحساب أو المحفظة المحول منها بدقة لمطابقة إشعار البنك فوراً.');
        document.getElementById('chkSenderName')?.focus();
        btn.disabled = false;
        return;
      }

      senderPhone = document.getElementById('chkSenderPhone')?.value?.trim() || '';
      const cleanPhone = senderPhone.replace(/\s+/g, '');
      const isEgPhone = /^01[0125][0-9]{8}$/.test(cleanPhone);
      const isInstaHandle = senderPhone.includes('@') || senderPhone.length >= 4;

      if (!senderPhone || (!isEgPhone && !isInstaHandle)) {
        alert('⚠️ يرجى إدخال رقم هاتف محفظة صحيح (11 رقماً يبدأ بـ 01) أو عنوان انستاباي صالح.');
        document.getElementById('chkSenderPhone')?.focus();
        btn.disabled = false;
        return;
      }

      if (!fileInput.files || fileInput.files.length === 0) {
        alert('⚠️ يرجى اختيار صورة إيصال التحويل أولاً!');
        btn.disabled = false;
        return;
      }

      paymentMethod = document.getElementById('chkPaymentMethod')?.value || 'instapay';
    }

    errBox.classList.add('hidden');
    btn.disabled = true;

    try {
      let fileToUpload = null;
      if (fileInput.files && fileInput.files.length > 0) {
        btn.innerHTML = '<span>جارٍ معالجة وضغط صورة الإيصال...</span> <span class="animate-spin">⏳</span>';
        fileToUpload = await compressReceiptImage(fileInput.files[0]);
      }

      btn.innerHTML = isFreeOrder
        ? '<span>جارٍ تفعيل كود الخصم وبدء الحل...</span> <span class="animate-spin">⏳</span>'
        : '<span>جارٍ فحص الإيصال ورفع الطلب...</span> <span class="animate-spin">⏳</span>';

      const combinedSenderInfo = isFreeOrder 
        ? '' 
        : `${senderName} | ${senderPhone} (${paymentMethod})`;

      const formData = new FormData();
      formData.append('studentId', draft.studentId);
      formData.append('password', draft.password);
      formData.append('grade', draft.grade);
      formData.append('course', draft.course);
      formData.append('packageType', draft.packageType);
      formData.append('selectedChapters', JSON.stringify(draft.selectedChapters || []));
      formData.append('referralCode', appliedReferralCode || '');
      formData.append('paymentMethod', isFreeOrder ? 'free_coupon_100' : paymentMethod);
      formData.append('senderName', senderName);
      formData.append('senderPhone', senderPhone);
      formData.append('senderInfo', combinedSenderInfo);
      formData.append('transferReference', currentRefCode || '');
      formData.append('transferTime', new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
      if (fileToUpload) {
        formData.append('receipt', fileToUpload);
      }

      let res;
      try {
        res = await fetch('/api/orders', {
          method: 'POST',
          body: formData
        });
      } catch (netErr) {
        throw new Error('تعذر الاتصال بالسيرفر أثناء رفع الإيصال. يرجى التأكد من استقرار الإنترنت والمحاولة مجدداً.');
      }

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        throw new Error('حدث خطأ غير متوقع في استجابة الخادم (' + res.status + '). يرجى المحاولة مرة أخرى.');
      }

      if (!data.success) {
        throw new Error(data.error || 'فشل تسجيل الطلب');
      }

      try {
        localStorage.setItem('qureo_active_order', JSON.stringify({
          orderId: data.orderId,
          studentId: draft.studentId,
          course: draft.course,
          isTrial: isFreeOrder,
          createdAt: Date.now()
        }));
      } catch (_) {}

      sessionStorage.removeItem('qs_checkout_draft');
      window.location.href = `/order/${data.orderId}`;

    } catch (err) {
      let msg = err.message || 'حدث خطأ غير متوقع';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        msg = 'تعذر الاتصال بالسيرفر. يرجى التأكد من استقرار الإنترنت والمحاولة مرة أخرى.';
      }
      errBox.textContent = msg;
      errBox.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = isFreeOrder 
        ? '<span>🚀 ابدأ الحل التلقائي فوراً مجاناً (خصم 100%)</span> <span>←</span>' 
        : '<span>تأكيد التحويل وإرسال الطلب</span> <span>✓</span>';
    }
  });
}

// --- Global Order Tracking & Website Completion Toast ---
function initGlobalOrderTracker() {
  if (typeof window === 'undefined') return;
  // If already on the dedicated order status page, don't show the duplicate floating pill
  if (window.location.pathname.startsWith('/order/')) return;

  let activeOrderStr = null;
  try {
    activeOrderStr = localStorage.getItem('qureo_active_order');
  } catch (_) {}

  if (!activeOrderStr) return;
  let activeOrder = null;
  try {
    activeOrder = JSON.parse(activeOrderStr);
  } catch (_) { return; }

  // Only track orders within the last 12 hours
  if (!activeOrder || !activeOrder.orderId || (Date.now() - (activeOrder.createdAt || 0) > 12 * 60 * 60 * 1000)) {
    return;
  }

  // If this order's completion alert was already dismissed by the user, don't spam them
  if (localStorage.getItem('qureo_dismissed_toast_' + activeOrder.orderId)) {
    return;
  }

  async function checkActiveOrderStatus() {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(activeOrder.orderId)}`);
      if (!res.ok) return;
      const data = await parseJsonResponse(res);
      if (!data || !data.success || !data.order) return;

      const order = data.order;
      if (order.status === 'completed') {
        showGlobalCompletionToast(activeOrder);
      } else if (order.status === 'solving' || order.status === 'in_queue') {
        showGlobalSolvingBadge(activeOrder, order.status);
      }
    } catch (_) {}
  }

  checkActiveOrderStatus();
  // Poll periodically every 15 seconds if an order is active
  setInterval(checkActiveOrderStatus, 15000);
}

function showGlobalCompletionToast(activeOrder) {
  if (document.getElementById('globalCompletionToast')) return;

  // Play fanfare sound
  playGlobalSuccessChime();

  const toast = document.createElement('div');
  toast.id = 'globalCompletionToast';
  toast.className = 'fixed bottom-6 right-6 left-6 sm:left-auto sm:max-w-md z-50 p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 border-2 border-emerald-500 shadow-2xl shadow-emerald-500/30 flex items-center gap-4 animate-bounce-short backdrop-blur-md';
  toast.innerHTML = `
    <div class="w-12 h-12 rounded-2xl bg-emerald-500 text-slate-950 flex items-center justify-center text-2xl font-black shadow-lg shadow-emerald-500/40 flex-shrink-0 animate-pulse">
      🏆
    </div>
    <div class="flex-grow text-right">
      <div class="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
        <span>🎉 تم الانتهاء من حل طلبك بنجاح!</span>
      </div>
      <div class="text-[11px] text-emerald-300 mt-0.5">
        طالب: <span class="font-mono font-bold text-white">${activeOrder.studentId || ''}</span> • 100% تم حصد الماسات 💎
      </div>
    </div>
    <div class="flex flex-col gap-1.5 flex-shrink-0">
      <a href="/order/${encodeURIComponent(activeOrder.orderId)}" class="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs text-center shadow transition-transform hover:scale-105 whitespace-nowrap">
        عرض النتيجة ↗
      </a>
      <button type="button" onclick="dismissGlobalToast('${activeOrder.orderId}')" class="text-[10px] text-slate-400 hover:text-white text-center py-0.5">
        إغلاق ✕
      </button>
    </div>
  `;
  document.body.appendChild(toast);
}

function showGlobalSolvingBadge(activeOrder, status) {
  // If completion toast already exists or solving badge exists, return
  if (document.getElementById('globalCompletionToast') || document.getElementById('globalSolvingBadge')) return;

  const badge = document.createElement('div');
  badge.id = 'globalSolvingBadge';
  badge.className = 'fixed bottom-6 left-6 z-40 p-2.5 px-4 rounded-full bg-slate-900/90 border border-emerald-500/50 shadow-xl shadow-emerald-500/10 flex items-center gap-2.5 backdrop-blur-md text-xs font-bold text-white hover:border-emerald-400 transition-all';
  badge.innerHTML = `
    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
    <span class="text-emerald-300 font-mono">${activeOrder.studentId}</span>
    <span class="text-slate-400">• ${status === 'solving' ? 'جارٍ الحل الآن...' : 'في الطابور'}</span>
    <a href="/order/${encodeURIComponent(activeOrder.orderId)}" class="text-emerald-400 hover:underline mr-1 text-[11px]">متابعة ↗</a>
  `;
  document.body.appendChild(badge);
}

window.dismissGlobalToast = function(orderId) {
  try {
    localStorage.setItem('qureo_dismissed_toast_' + orderId, 'true');
  } catch (_) {}
  const toast = document.getElementById('globalCompletionToast');
  if (toast) toast.remove();
};

function playGlobalSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + idx * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.12);
      osc.stop(ctx.currentTime + idx * 0.12 + 0.42);
    });
  } catch (_) {}
}

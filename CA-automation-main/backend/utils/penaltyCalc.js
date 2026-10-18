// utils/penaltyCalc.js
// Statutory Penalty Calculation Engine for Indian CA Practice
// Covers: GST (Sec 47, Sec 50), TDS (Sec 234E, Sec 201(1A)), ITR (Sec 234F, Sec 234A), ROC (Sec 92, Sec 137)

/**
 * Format number into Indian currency format (e.g. ₹1,25,000)
 */
function formatINR(amount) {
  const num = Math.round(parseFloat(amount) || 0);
  return '₹' + num.toLocaleString('en-IN');
}

/**
 * Calculate GST Late Fee & Interest
 * @param {number} daysLate - Days passed since statutory due date
 * @param {number} taxLiability - Total tax payable (CGST + SGST + IGST)
 * @param {boolean} isNilReturn - Whether filing is a NIL return
 * @returns {Object} Penalty breakdown
 */
function calculateGSTPenalty(daysLate, taxLiability = 0, isNilReturn = false) {
  const days = Math.max(0, parseInt(daysLate) || 0);
  if (days === 0) {
    return { lateFeePenalty: 0, interestAmount: 0, totalDue: 0, breakdown: 'On time, zero penalty.' };
  }

  // Late fee: ₹50/day (₹25 CGST + ₹25 SGST) or ₹20/day for NIL return
  const perDayFee = isNilReturn ? 20 : 50;
  const maxFee = 10000;
  const lateFeePenalty = Math.min(days * perDayFee, maxFee);

  // Interest: 18% per annum on net cash tax liability under Section 50(1)
  const tax = Math.max(0, parseFloat(taxLiability) || 0);
  const interestAmount = tax > 0 ? Math.round((tax * 0.18 * days) / 365) : 0;
  const totalDue = lateFeePenalty + interestAmount;

  return {
    daysLate: days,
    perDayFee,
    lateFeePenalty,
    interestAmount,
    totalDue,
    breakdown: `Late fee: ${formatINR(lateFeePenalty)} (${days} days @ ₹${perDayFee}/day)${
      tax > 0 ? ` + Interest: ${formatINR(interestAmount)} (18% p.a. on ${formatINR(tax)})` : ''
    }`,
  };
}

/**
 * Calculate TDS Late Fee (Sec 234E) & Interest (Sec 201(1A))
 * @param {number} daysLate - Days late
 * @param {number} tdsAmount - TDS deducted / payable
 * @param {'late_payment' | 'late_filing'} paymentOrFiling
 * @returns {Object}
 */
function calculateTDSPenalty(daysLate, tdsAmount = 0, paymentOrFiling = 'late_filing') {
  const days = Math.max(0, parseInt(daysLate) || 0);
  const amount = Math.max(0, parseFloat(tdsAmount) || 0);
  const monthsLate = Math.ceil(days / 30);

  if (days === 0) {
    return { lateFee: 0, interest: 0, total: 0, section: 'Sec 234E / 201', breakdown: 'No delay' };
  }

  if (paymentOrFiling === 'late_payment') {
    // Interest under Sec 201(1A): 1.5% for every month or part of a month from deduction to payment
    const interest = Math.round(amount * 0.015 * monthsLate);
    return {
      daysLate: days,
      monthsLate,
      lateFee: 0,
      interest,
      total: interest,
      section: 'Sec 201(1A)',
      breakdown: `TDS Interest (Sec 201(1A)): ${formatINR(interest)} (${monthsLate} month(s) @ 1.5%/mo on ${formatINR(amount)})`,
    };
  } else {
    // Late filing under Sec 234E: ₹200 per day of default, capped at TDS amount
    const rawLateFee = days * 200;
    const lateFee = amount > 0 ? Math.min(rawLateFee, amount) : rawLateFee;
    return {
      daysLate: days,
      lateFee,
      interest: 0,
      total: lateFee,
      section: 'Sec 234E',
      breakdown: `TDS Late Filing Fee (Sec 234E): ${formatINR(lateFee)} (${days} days @ ₹200/day${
        amount > 0 ? `, capped at TDS amount ${formatINR(amount)}` : ''
      })`,
    };
  }
}

/**
 * Calculate Income Tax Return (ITR) Penalty under Sec 234F & Sec 234A
 * @param {number} daysLate
 * @param {number} taxLiability
 * @param {number} totalIncome
 * @returns {Object}
 */
function calculateITRPenalty(daysLate, taxLiability = 0, totalIncome = 600000) {
  const days = Math.max(0, parseInt(daysLate) || 0);
  const tax = Math.max(0, parseFloat(taxLiability) || 0);
  const income = parseFloat(totalIncome) || 0;

  if (days === 0) {
    return { sec234F_fee: 0, sec234A_interest: 0, total: 0, breakdown: 'Filed on time' };
  }

  // Sec 234F fee: ₹1,000 if total income <= 5 Lakhs, else ₹5,000
  const sec234F_fee = income <= 500000 ? 1000 : 5000;

  // Sec 234A interest: 1% per month or part of a month on outstanding tax liability
  const monthsLate = Math.ceil(days / 30);
  const sec234A_interest = tax > 0 ? Math.round(tax * 0.01 * monthsLate) : 0;
  const total = sec234F_fee + sec234A_interest;

  return {
    daysLate: days,
    monthsLate,
    sec234F_fee,
    sec234A_interest,
    total,
    breakdown: `ITR Late Fee (Sec 234F): ${formatINR(sec234F_fee)}${
      tax > 0 ? ` + Interest (Sec 234A): ${formatINR(sec234A_interest)} (${monthsLate} mo @ 1%/mo)` : ''
    }`,
  };
}

/**
 * Calculate MCA / ROC Late Filing Penalty
 * Forms: AOC-4 (Financials) and MGT-7 (Annual Return)
 * @param {string} formType
 * @param {number} daysLate
 * @returns {Object}
 */
function calculateROCPenalty(formType = 'AOC-4', daysLate = 0) {
  const days = Math.max(0, parseInt(daysLate) || 0);
  if (days === 0) {
    return { penalty: 0, section: 'Companies Act', breakdown: 'On time' };
  }

  // MCA penalty under Sec 403 / Companies (Registration Offices and Fees) Rules: ₹100 per day
  const penalty = days * 100;
  const section = formType.toUpperCase().includes('AOC') ? 'Sec 137' : 'Sec 92';

  return {
    formType,
    daysLate: days,
    penalty,
    section,
    breakdown: `ROC ${formType} Late Filing (${section}): ${formatINR(penalty)} (${days} days @ ₹100/day)`,
  };
}

/**
 * Get human-readable statutory penalty summary string for reminders & notifications
 * @param {string} complianceType - e.g. 'GSTR-3B', 'GSTR-1', 'TDS 26Q', 'ITR Non-Audit', 'AOC-4'
 * @param {number} daysLate - Days late (positive integer)
 * @param {number} amount - Tax or fee amount
 * @returns {string} Human-readable penalty notice
 */
function getPenaltySummary(complianceType = '', daysLate = 0, amount = 0) {
  const type = String(complianceType || '').toUpperCase();
  const days = Math.max(0, parseInt(daysLate) || 0);

  if (days === 0) return 'Statutory due date approaching. File on time to avoid penalties.';

  if (type.includes('GSTR-3B') || type.includes('GSTR3B')) {
    const res = calculateGSTPenalty(days, amount);
    return `🚨 ${complianceType} is ${days} day(s) overdue! Estimated late fee is ${formatINR(
      res.lateFeePenalty
    )} (₹50/day) plus 18% p.a. interest on unpaid tax.`;
  }

  if (type.includes('GSTR-1') || type.includes('GSTR1')) {
    const res = calculateGSTPenalty(days, 0);
    return `🚨 ${complianceType} is ${days} day(s) overdue! Late fee of ${formatINR(
      res.lateFeePenalty
    )} applies and E-Way bill generation may be blocked.`;
  }

  if (type.includes('TDS') || type.includes('26Q') || type.includes('24Q') || type.includes('281')) {
    const isPayment = type.includes('281') || type.includes('CHALLAN');
    const res = calculateTDSPenalty(days, amount, isPayment ? 'late_payment' : 'late_filing');
    return `🚨 ${complianceType} is ${days} day(s) overdue! ${res.breakdown}.`;
  }

  if (type.includes('ITR') || type.includes('INCOME TAX')) {
    const res = calculateITRPenalty(days, amount);
    return `🚨 ${complianceType} is ${days} day(s) overdue! Statutory late fee of ${formatINR(
      res.sec234F_fee
    )} (Sec 234F) + 1%/month interest applies.`;
  }

  if (type.includes('AOC') || type.includes('MGT') || type.includes('ROC')) {
    const res = calculateROCPenalty(complianceType, days);
    return `🚨 MCA ${complianceType} is ${days} day(s) overdue! Ongoing penalty of ${formatINR(
      res.penalty
    )} (₹100/day) accumulating.`;
  }

  if (type.includes('44AB') || type.includes('AUDIT')) {
    return `🚨 Tax Audit under Sec 44AB is ${days} day(s) overdue! Penalty under Sec 271B: 0.5% of turnover (max ₹1.5 Lakh).`;
  }

  // Generic fallback
  return `🚨 ${complianceType} is ${days} day(s) overdue! Statutory late filing fees and interest apply.`;
}

module.exports = {
  formatINR,
  calculateGSTPenalty,
  calculateTDSPenalty,
  calculateITRPenalty,
  calculateROCPenalty,
  getPenaltySummary,
};

// tests/verify.js
// Verification suite for CA Firm Automation Suite upgrades

const penaltyCalc = require('../utils/penaltyCalc');
const { COMPLIANCE_CALENDAR, DOCUMENT_CHECKLIST, PENALTIES } = require('../config/constants');
const { keys } = require('../config/keys');
const ocrParser = require('../ai/ocrParser');
const r2Service = require('../services/r2Service');

console.log('🧪 RUNNING CA SUITE COMPREHENSIVE VERIFICATION TESTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let passed = 0;
let total = 0;

function assert(condition, testName) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
  }
}

// ── TEST 1: GST Penalty Calculation ──
const gst10d = penaltyCalc.calculateGSTPenalty(10, 50000, false);
assert(gst10d.lateFeePenalty === 500, 'GST 10 days late fee is ₹500 (10 * ₹50)');
assert(gst10d.interestAmount > 0, 'GST interest on ₹50,000 tax is calculated (>0)');
assert(gst10d.totalDue === 500 + gst10d.interestAmount, 'GST total due equals late fee + interest');

// GST Cap test (max ₹10,000)
const gstCap = penaltyCalc.calculateGSTPenalty(300, 0, false);
assert(gstCap.lateFeePenalty === 10000, 'GST late fee caps at ₹10,000 even after 300 days');

// ── TEST 2: TDS Penalties ──
const tdsLatePayment = penaltyCalc.calculateTDSPenalty(45, 10000, 'late_payment');
assert(tdsLatePayment.interest === 300, 'TDS late payment interest is 2 months * 1.5% * ₹10,000 = ₹300');

const tdsLateFiling = penaltyCalc.calculateTDSPenalty(10, 5000, 'late_filing');
assert(tdsLateFiling.lateFee === 2000, 'TDS Sec 234E late fee is 10 days * ₹200 = ₹2,000');

// ── TEST 3: ITR Penalties ──
const itrLowIncome = penaltyCalc.calculateITRPenalty(30, 0, 400000);
assert(itrLowIncome.sec234F_fee === 1000, 'ITR Sec 234F fee for income <= 5L is ₹1,000');

const itrHighIncome = penaltyCalc.calculateITRPenalty(30, 20000, 800000);
assert(itrHighIncome.sec234F_fee === 5000, 'ITR Sec 234F fee for income > 5L is ₹5,000');
assert(itrHighIncome.sec234A_interest === 200, 'ITR Sec 234A interest is 1% on ₹20,000 = ₹200');

// ── TEST 4: ROC Penalties ──
const rocPenalty = penaltyCalc.calculateROCPenalty('AOC-4', 15);
assert(rocPenalty.penalty === 1500, 'ROC AOC-4 penalty is 15 days * ₹100 = ₹1,500');

// ── TEST 5: Penalty Summary Strings ──
const gstrSummary = penaltyCalc.getPenaltySummary('GSTR-3B', 5, 25000);
assert(gstrSummary.includes('₹250') && gstrSummary.includes('18%'), 'GSTR-3B penalty summary includes ₹250 late fee and 18% note');

// ── TEST 6: Constants & Checklists ──
assert(COMPLIANCE_CALENDAR.monthly.length >= 4, 'Compliance calendar contains all monthly filings');
assert(DOCUMENT_CHECKLIST['Tax Audit 44AB'].length >= 5, 'Tax audit 44AB checklist contains required work papers');
assert(PENALTIES['GSTR-3B'].lateFeePerDay === 50, 'Penalty constants verified');

// ── TEST 7: OCR & Reconciliation ──
const sampleExtracted = [
  { supplierGSTIN: '27AAACA1234A1Z5', invoiceNumber: 'INV-001', totalAmount: 59000 },
  { supplierGSTIN: '27AAACA1234A1Z5', invoiceNumber: 'INV-002', totalAmount: 11800 },
];
const sampleGstr2b = [
  { supplierGSTIN: '27AAACA1234A1Z5', invoiceNumber: 'INV-001', totalAmount: 59000 },
  { supplierGSTIN: '27AAACA1234A1Z5', invoiceNumber: 'INV-002', totalAmount: 10000 }, // Discrepancy ₹1,800
];
const reco = ocrParser.matchGSTR2B(sampleExtracted, sampleGstr2b);
assert(reco.matched.length === 1, 'Reconciliation matched 1 invoice perfectly');
assert(reco.mismatched.length === 1, 'Reconciliation flagged 1 mismatched invoice');
assert(reco.totalITCDifference === 1800, 'Reconciliation calculated exact ₹1,800 tax discrepancy');

// ── TEST 8: R2 Local Storage Fallback ──
r2Service.uploadDocument(Buffer.from('test statement'), 'test.pdf', 'application/pdf', 'clients/test/stmt.pdf')
  .then((res) => {
    assert(res.success === true, 'Document saved successfully (via R2 or local vault)');
    console.log(`\n🏁 TEST SUMMARY: ${passed}/${total} assertions passed (${Math.round((passed / total) * 100)}%).\n`);
  });

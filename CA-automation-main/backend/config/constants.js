// config/constants.js
// Indian Statutory Compliance Calendar, Document Checklists, and Penalty Constants
// CA Firm Automation Suite

const COMPLIANCE_CALENDAR = {
  monthly: [
    { type: 'GSTR-1', authority: 'GSTN', day: 11, description: 'Monthly GSTR-1 outward supplies return' },
    { type: 'GSTR-3B', authority: 'GSTN', day: 20, description: 'Monthly GSTR-3B summary return + tax payment' },
    { type: 'TDS Challan 281', authority: 'Income Tax', day: 7, description: 'Monthly TDS deposit (non-March)' },
    { type: 'ESIC', authority: 'ESIC', day: 15, description: 'Monthly ESIC contribution payment' },
    { type: 'PF/EPFO', authority: 'EPFO', day: 15, description: 'Monthly PF contribution payment' },
  ],
  quarterly: [
    { type: 'GSTR-1 Quarterly', authority: 'GSTN', months: [1, 4, 7, 10], day: 13, description: 'QRMP scheme outward supplies' },
    { type: 'GSTR-3B Quarterly', authority: 'GSTN', months: [1, 4, 7, 10], day: 22, description: 'QRMP scheme summary return' },
    { type: 'TDS 24Q/26Q', authority: 'Income Tax', months: [1, 5, 7, 10], day: 31, description: 'Quarterly TDS return statement' },
    { type: 'Advance Tax Q1', authority: 'Income Tax', month: 6, day: 15, description: '15% of estimated tax' },
    { type: 'Advance Tax Q2', authority: 'Income Tax', month: 9, day: 15, description: '45% of estimated tax' },
    { type: 'Advance Tax Q3', authority: 'Income Tax', month: 12, day: 15, description: '75% of estimated tax' },
    { type: 'Advance Tax Q4', authority: 'Income Tax', month: 3, day: 15, description: '100% of estimated tax' },
  ],
  annual: [
    { type: 'GSTR-9', authority: 'GSTN', month: 12, day: 31, description: 'Annual GST return' },
    { type: 'ITR Non-Audit', authority: 'Income Tax', month: 7, day: 31, description: 'Individual & non-audit business ITR' },
    { type: 'Tax Audit 44AB', authority: 'Income Tax', month: 9, day: 30, description: 'Tax Audit Report upload deadline' },
    { type: 'ITR Audit Cases', authority: 'Income Tax', month: 10, day: 31, description: 'ITR for audit-covered entities' },
    { type: 'ITR Partner Firms', authority: 'Income Tax', month: 10, day: 31, description: 'ITR for partners of audit firms' },
    { type: 'AOC-4', authority: 'MCA', month: 10, day: 30, description: 'MCA Financial statements filing' },
    { type: 'MGT-7', authority: 'MCA', month: 11, day: 29, description: 'MCA Annual return of company' },
  ],
};

const DOCUMENT_CHECKLIST = {
  'GSTR-3B': [
    'Monthly Bank Statement',
    'Sales Register',
    'Purchase Register',
    'Input Tax Credit Summary (GSTR-2B)',
  ],
  'GSTR-1': [
    'Sales Invoices List',
    'Debit/Credit Notes Register',
    'HSN-wise Summary',
  ],
  'TDS 24Q/26Q': [
    'Salary Register',
    'Deductee PAN List',
    'Payment Challan Copies (BSR Code & Challan No)',
  ],
  'Tax Audit 44AB': [
    'Audited Balance Sheet & P&L',
    'Bank Confirmation Letters',
    'Fixed Asset Register with Depreciation Details',
    'Debtors & Creditors Ageing List',
    'Loan Confirmation & Interest Certificate',
    'Form 3CA/3CB and Form 3CD Data',
  ],
  'ITR Non-Audit': [
    'Form 16 (Part A & B)',
    'Form 26AS & AIS/TIS Summary',
    'Bank Statements (All Accounts)',
    'Investment Proofs (80C / 80D / Housing Loan Interest)',
    'Capital Gains Statements',
  ],
  'AOC-4': [
    'Signed Board Resolution & Notice',
    'Auditors Report with CARO Notes',
    'Balance Sheet & P&L Statement',
    'Notes to Accounts & Significant Accounting Policies',
    'Cash Flow Statement',
  ],
  'MGT-7': [
    'List of Shareholders & Debenture Holders',
    'Details of Directors & Shareholding Changes',
    'Board Meeting Attendance Records',
  ],
};

const PENALTIES = {
  'GSTR-1': {
    lateFeePerDay: 50,
    nilReturnLateFeePerDay: 20,
    maxLateFee: 10000,
    interestPerAnnum: null,
    riskTag: 'E-Way Bill Blocking & Sec 47 Late Fee',
  },
  'GSTR-3B': {
    lateFeePerDay: 50,
    nilReturnLateFeePerDay: 20,
    maxLateFee: 10000,
    interestPerAnnum: 18,
    riskTag: '₹50/day Late Fee + 18% Interest p.a.',
  },
  'TDS 24Q/26Q': {
    lateFeePerDay: 200,
    section: 'Sec 234E',
    interestPerMonth: 1.5,
    riskTag: 'Sec 234E ₹200/day + 1.5%/mo Interest',
  },
  'TDS Challan 281': {
    interestPerMonth: 1.5,
    riskTag: '1.5% per month interest under Sec 201(1A)',
  },
  'Advance Tax': {
    interestPerMonth: 1.0,
    riskTag: 'Sec 234B & 234C Interest (1%/month)',
  },
  'ITR Non-Audit': {
    feeUpto5L: 1000,
    feeAbove5L: 5000,
    section: 'Sec 234F',
    interestPerMonth: 1.0,
    riskTag: 'Sec 234F Late Fee ₹1,000–₹5,000 + 1%/mo Int',
  },
  'Tax Audit 44AB': {
    penaltyPercentage: 0.5,
    maxPenalty: 150000,
    section: 'Sec 271B',
    riskTag: 'Sec 271B Penalty: 0.5% of turnover (max ₹1.5 Lakh)',
  },
  'AOC-4': {
    lateFeePerDay: 100,
    section: 'Companies Act Sec 137',
    riskTag: 'MCA ₹100/day ongoing penalty',
  },
  'MGT-7': {
    lateFeePerDay: 100,
    section: 'Companies Act Sec 92',
    riskTag: 'MCA ₹100/day ongoing penalty',
  },
};

module.exports = {
  COMPLIANCE_CALENDAR,
  DOCUMENT_CHECKLIST,
  PENALTIES,
};

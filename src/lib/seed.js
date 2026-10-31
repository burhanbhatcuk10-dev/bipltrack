import { r2, nowStamp } from './utils.js';

export function buildItems(list, products) {
  return list.map(([pid, qty]) => {
    const p = products.find(x => x.id === pid);
    return {productId: p.id, name: p.name, category: p.category, qty, price: p.price, gst: p.gst};
  });
}
export function totalsOf(items) {
  let subtotal = 0, taxTotal = 0;
  items.forEach(i => { const base = i.price * i.qty; subtotal += base; taxTotal += base * i.gst / 100; });
  subtotal = r2(subtotal); taxTotal = r2(taxTotal);
  return {subtotal, taxTotal, grandTotal: r2(subtotal + taxTotal)};
}

export function seed() {
  const products = [
    {id: 'P-101', name: 'Rehmat Shahi Kashmiri Saffron 5g', category: 'Saffron', warehouse: 'Khunmoh Phase II - W1', stock: 320, minStock: 50, price: 1450, gst: 5},
    {id: 'P-102', name: 'Diamond Saffron Mongra Grade 10g', category: 'Saffron', warehouse: 'Khunmoh Phase II - W1', stock: 110, minStock: 30, price: 3200, gst: 5},
    {id: 'P-103', name: 'Rehmat Royal Garam Masala 250g', category: 'Spices', warehouse: 'Khunmoh Phase II - W2', stock: 1250, minStock: 200, price: 180, gst: 12},
    {id: 'P-104', name: 'Rehmat Turmeric Powder (Haldi) 500g', category: 'Spices', warehouse: 'Khunmoh Phase II - W2', stock: 85, minStock: 150, price: 110, gst: 5},
    {id: 'P-105', name: 'Hidden Valley Organic Walnut Kernels 500g', category: 'Food Items', warehouse: 'Khunmoh Phase II - W3', stock: 640, minStock: 100, price: 650, gst: 12},
    {id: 'P-106', name: 'Rehmat Kashmiri Mirch Powder 500g', category: 'Spices', warehouse: 'Khunmoh Phase II - W2', stock: 45, minStock: 100, price: 240, gst: 12},
    {id: 'P-107', name: 'Hidden Valley Acacia Honey 1kg', category: 'Food Items', warehouse: 'Khunmoh Phase II - W3', stock: 410, minStock: 80, price: 550, gst: 18},
    {id: 'P-108', name: 'Rehmat Kashmiri Jeera (Cumin) 250g', category: 'Spices', warehouse: 'Khunmoh Phase II - W2', stock: 890, minStock: 150, price: 160, gst: 5}
  ];
  const customers = [
    {id: 'C-201', name: 'Kashmir Super Mart', type: 'Wholesale', market: 'Lal Chowk, Srinagar', phone: '+91 97001 22334', gstin: '01AABCR1234F1Z5', creditLimit: 500000, opening: 0, onHold: false, notes: ''},
    {id: 'C-202', name: 'Mughal Bazaar Grocers', type: 'Retail', market: 'Anantnag Main Market', phone: '+91 98112 55667', gstin: '01XYZPM8899K2Z1', creditLimit: 150000, opening: 0, onHold: false, notes: ''},
    {id: 'C-203', name: 'Chadoora Traders & Co.', type: 'Wholesale', market: 'Chadoora, Budgam', phone: '+91 99003 44112', gstin: '01PQWCT4432L1Z9', creditLimit: 300000, opening: 0, onHold: true, notes: 'On hold until overdue is cleared.'},
    {id: 'C-204', name: 'Pampore Saffron & Spices Hub', type: 'Wholesale', market: 'Pampore, Pulwama', phone: '+91 94190 88776', gstin: '01BRKPS9988M1Z3', creditLimit: 800000, opening: 0, onHold: false, notes: ''},
    {id: 'C-205', name: 'Zainakadal Daily Needs', type: 'Retail', market: 'Zainakadal, Srinagar', phone: '+91 92055 11990', gstin: '01ZNKDL7766N1Z8', creditLimit: 100000, opening: 0, onHold: false, notes: ''}
  ];
  const leads = [
    {id: 'L-301', businessName: 'Himalayan Organic Store', contactPerson: 'Mr. Fayaz Ahmed', phone: '+91 99061 55443', market: 'Sonwar, Srinagar', stage: 'Qualified', potential: 250000, assignedTo: 'U-2', notes: ''},
    {id: 'L-302', businessName: 'Chenab Retail Mart', contactPerson: 'Ms. Nusrat Jahan', phone: '+91 94191 33221', market: 'Baramulla Town', stage: 'Initial Contact', potential: 120000, assignedTo: 'U-2', notes: ''},
    {id: 'L-303', businessName: 'Peer Panchal Superstore', contactPerson: 'Mr. Tariq Bhat', phone: '+91 97970 44556', market: 'Islamabad, Anantnag', stage: 'Negotiation', potential: 400000, assignedTo: 'U-1', notes: ''}
  ];
  const users = [
    {id: 'U-1', name: 'Mr. Zaffer Banday', title: 'Managing Director', role: 'admin', email: 'zaffer@bandayimpex.com', active: true},
    {id: 'U-2', name: 'Bilal Ahmad', title: 'Field Agent', role: 'sales', email: 'bilal.field@bandayimpex.com', active: true},
    {id: 'U-3', name: 'Tariq Khurshid', title: 'Warehouse Supervisor', role: 'warehouse', email: 'khunmoh.store@bandayimpex.com', active: true}
  ];
  const company = {
    name: 'Banday Impex Pvt. Ltd.', gstin: '01AABCB1234P1ZV',
    address: 'Khunmoh Phase II Industrial Complex, Srinagar, J&K - 190021',
    phone: '', email: 'it@bandayimpex.com',
    bank: '', terms: 'Payment due within 15 days of invoice date.\nGoods once sold are subject to the Khunmoh warehouse return policy.'
  };

  // [id, date, customer, items, status, paid fraction, salesperson]
  const defs = [
    ['ORD-8990', '2026-05-08', 'C-204', [['P-101', 30], ['P-108', 100]], 'Delivered', 1, 'U-2'],
    ['ORD-8991', '2026-05-20', 'C-202', [['P-103', 80], ['P-104', 60]], 'Delivered', 1, 'U-2'],
    ['ORD-8992', '2026-06-02', 'C-205', [['P-105', 20], ['P-107', 15]], 'Delivered', 1, 'U-2'],
    ['ORD-9001', '2026-06-10', 'C-201', [['P-101', 20], ['P-103', 50]], 'Dispatched', 1, 'U-2'],
    ['ORD-8993', '2026-07-04', 'C-201', [['P-105', 60], ['P-107', 40]], 'Delivered', 1, 'U-2'],
    ['ORD-8994', '2026-07-18', 'C-204', [['P-102', 25]], 'Delivered', 1, 'U-2'],
    ['ORD-8995', '2026-08-09', 'C-202', [['P-106', 40], ['P-108', 60]], 'Delivered', .5, 'U-2'],
    ['ORD-8996', '2026-08-22', 'C-203', [['P-103', 100]], 'Delivered', 0, 'U-2'],
    ['ORD-8997', '2026-09-05', 'C-201', [['P-101', 25], ['P-107', 30]], 'Delivered', 1, 'U-2'],
    ['ORD-8998', '2026-09-14', 'C-204', [['P-102', 20]], 'Delivered', 1, 'U-2'],
    ['ORD-8999', '2026-10-06', 'C-205', [['P-103', 40], ['P-108', 40]], 'Delivered', 1, 'U-2'],
    ['ORD-9002', '2026-10-24', 'C-204', [['P-102', 15]], 'Pack Approval', 0, 'U-2']
  ];
  const orders = [], payments = [];
  let payNo = 500;
  const modes = ['Bank Transfer (NEFT)', 'UPI / GPay', 'Cheque', 'Cash'];
  defs.forEach(([id, date, cid, list, status, frac, sp], idx) => {
    const c = customers.find(x => x.id === cid);
    const items = buildItems(list, products);
    const t = totalsOf(items);
    orders.push({id, date, customerId: cid, customerName: c.name, market: c.market, items, ...t, status, salesperson: sp, creditOverride: false, dispatchedOn: ['Dispatched', 'Delivered'].includes(status) ? date : '', deliveredOn: status === 'Delivered' ? date : ''});
    if (frac > 0) {
      const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + 3);
      payments.push({id: 'PAY-' + (++payNo), orderId: id, customerId: cid, customerName: c.name, date: d.toISOString().slice(0, 10), mode: modes[idx % 4], amount: r2(t.grandTotal * frac), reference: ['UTR#9882310', 'UPI/21778933', 'CHQ-004', 'CASH'][idx % 4] + String(10 + idx)});
    }
  });
  // Set opening balances so each account starts at its known outstanding.
  const target = {'C-201': 145000, 'C-202': 142000, 'C-203': 310000, 'C-204': 230000, 'C-205': 25000};
  customers.forEach(c => {
    const billed = orders.filter(o => o.customerId === c.id).reduce((a, o) => a + o.grandTotal, 0);
    const paid = payments.filter(p => p.customerId === c.id).reduce((a, p) => a + p.amount, 0);
    c.opening = r2(target[c.id] - billed + paid);
  });
  orders.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  payments.sort((a, b) => b.date.localeCompare(a.date));
  const logs = [
    {id: 'LOG-3', ts: nowStamp(), user: 'System', action: 'Demo data loaded'},
  ];
  return {products, customers, leads, orders, payments, logs, users, company, session: 'U-1',
    seq: {ORD: 9003, PAY: 600, P: 109, C: 206, L: 304, U: 4, LOG: 4}};
}


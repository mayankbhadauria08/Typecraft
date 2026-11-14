// Premium practice packs (docs/SAAS-CONTRACTS.md §6). Every text here is original, written for
// TypeCraft: names, numbers, companies and addresses are made up. Texts use printable ASCII,
// the rupee sign and, in the code pack, line breaks (typed with Enter).
// Shape: { id, title, description, exercises: [{ id, title, text }] }.

const numbers = {
  id: 'numbers',
  title: 'Numbers and data entry',
  description: 'Invoices, phone numbers, dates, PIN codes and amounts in rupees: the number row and the symbols that go with it.',
  exercises: [
    { id: 'phones', title: 'Phone numbers', text:
      'Call the front desk on 080-4127 3390 or the service line on +91 98450 21763. For urgent work, Ravi is on +91 90083 55120 and Meena on +91 70221 48906. The fax number 080-4127 3391 is no longer in use. Toll free: 1800 425 0716.' },
    { id: 'pincodes', title: 'Addresses and PIN codes', text:
      'Plot 14, Sector 21, Gandhinagar 382021. Flat 3B, Lakeview Towers, Kakkanad, Kochi 682030. 22/7 Station Road, Ajmer 305001. Shop No. 9, Main Bazaar, Shimla 171001. House 118, Ward 6, Tezpur 784001. Door 4-56, Gandhi Nagar, Vijayawada 520003.' },
    { id: 'dates', title: 'Dates and times', text:
      'The office opens on 02/01/2027 at 09:30 and the audit runs from 15-03-2027 to 19-03-2027. Submit forms by 31.03.2027, 17:00 IST. The next review is on 7 April 2027 at 11:15 am; the one after that, 05/05/2027 at 3:45 pm.' },
    { id: 'invoice', title: 'Invoice lines', text:
      'Inv No. KT/2026/0417 dated 12/11/2026. Item 1: A4 paper, 20 reams @ 265.00 = 5,300.00. Item 2: Toner 88A, 3 nos @ 1,450.00 = 4,350.00. Item 3: Stapler pins, 50 boxes @ 18.50 = 925.00. Sub-total 10,575.00; freight 250.00; total 10,825.00.' },
    { id: 'rupees', title: 'Amounts in rupees', text:
      'Opening balance ₹48,250.75. Deposit ₹12,000.00 on 4 Nov. Rent paid ₹18,500.00. Electricity ₹2,316.40. Mobile recharge ₹299.00. Interest credited ₹184.62. Closing balance ₹39,619.97. Minimum balance required: ₹5,000.' },
    { id: 'gst', title: 'GST summary', text:
      'Taxable value 24,600.00. CGST @ 9% = 2,214.00. SGST @ 9% = 2,214.00. Total tax 4,428.00. Invoice total 29,028.00. Round off 0.00. GSTIN 29ABCDE1234F1Z5 (sample). HSN 4802, 8443, 7310. Place of supply: Karnataka (29).' },
    { id: 'deposit', title: 'Deposit slip', text:
      'Account no. 3021 0045 7781 26. Branch code 004512. Cash: 500 x 14 = 7,000; 200 x 9 = 1,800; 100 x 23 = 2,300; 50 x 7 = 350; 10 x 18 = 180. Total cash 11,630. Cheque no. 004417 for 25,000. Grand total 36,630.' },
    { id: 'stock', title: 'Stock register', text:
      'Code 1104, Basmati rice 25 kg, opening 42, received 18, issued 37, closing 23. Code 1107, Toor dal 1 kg, opening 120, received 60, issued 96, closing 84. Code 1212, Sunflower oil 5 L, opening 35, received 0, issued 12, closing 23.' },
    { id: 'tickets', title: 'Tickets and reference numbers', text:
      'PNR 482-5519037, Train 12628, Coach B3, Berth 41 (LB), departs 21:05. Ref. no. SR/HR/2026/0883. Complaint ID 77412093. Order #OD-2026-11-00456. Policy no. 0012-4478-9031. Vehicle KA-05-MN-4472. Batch 26-B/114.' },
    { id: 'marks', title: 'Marks sheet', text:
      'Roll 1041: English 78, Hindi 81, Maths 92, Science 88, Social 74; total 413/500, 82.6%. Roll 1042: 65, 70, 58, 71, 69; total 333/500, 66.6%. Roll 1043: 90, 86, 97, 93, 89; total 455/500, 91.0%. Class average 80.07%.' },
    { id: 'measures', title: 'Measurements and percentages', text:
      'Room A: 4.2 m x 3.6 m = 15.12 sq m. Room B: 3.9 m x 3.0 m = 11.70 sq m. Wall height 2.85 m. Paint needed: 18.5 L at 12.4 sq m per litre. Discount 12.5% on 7,840 = 980. Net 6,860. Moisture 13.2%, target below 14%.' },
    { id: 'records', title: 'Customer records', text:
      'C-20431 | Asha Kulkarni | 94481 20376 | Pune 411038 | due 2,450.00 | 18/11/2026. C-20432 | Imran Sheikh | 98200 61145 | Thane 400601 | due 0.00 | paid. C-20433 | Lalitha Rao | 99860 33021 | Mysuru 570009 | due 11,875.50 | 02/12/2026.' },
  ],
};

const code = {
  id: 'code',
  title: 'Code',
  description: 'Short JavaScript, Python, HTML, CSS and SQL snippets: brackets, operators, quotes and indentation.',
  exercises: [
    { id: 'js-sum', title: 'JavaScript: add up a list', text:
`function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return Math.round(sum * 100) / 100;
}` },
    { id: 'js-filter', title: 'JavaScript: filter and map', text:
`const late = orders
  .filter((o) => o.status === 'pending' && o.days > 7)
  .map((o) => ({ id: o.id, name: o.customer, days: o.days }));
console.log(late.length + ' orders need a reminder');` },
    { id: 'js-fetch', title: 'JavaScript: fetch JSON', text:
`async function loadUser(id) {
  const res = await fetch('/api/users/' + id);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return { name: data.name, email: data.email || null };
}` },
    { id: 'js-dom', title: 'JavaScript: a button handler', text:
`const button = document.querySelector('#save');
button.addEventListener('click', (event) => {
  event.preventDefault();
  const name = document.querySelector('#name').value.trim();
  if (name.length < 2) return alert('Name is too short');
  localStorage.setItem('name', name);
});` },
    { id: 'py-grades', title: 'Python: grade a score', text:
`def grade(score):
    if score >= 90:
        return "A"
    elif score >= 75:
        return "B"
    elif score >= 50:
        return "C"
    return "F"

print([grade(s) for s in (93, 78, 41)])` },
    { id: 'py-dict', title: 'Python: count words', text:
`counts = {}
for word in text.lower().split():
    word = word.strip(".,;:!?")
    counts[word] = counts.get(word, 0) + 1

top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
print(top)` },
    { id: 'py-file', title: 'Python: read a CSV file', text:
`import csv

with open("sales.csv", newline="") as f:
    rows = list(csv.DictReader(f))

total = sum(float(r["amount"]) for r in rows if r["region"] == "South")
print(f"South: {total:.2f}")` },
    { id: 'html-form', title: 'HTML: a sign-up form', text:
`<form action="/signup" method="post">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" minlength="8">
  <button type="submit">Create account</button>
</form>` },
    { id: 'html-table', title: 'HTML: a small table', text:
`<table class="prices">
  <tr><th>Plan</th><th>Months</th><th>Price</th></tr>
  <tr><td>Basic</td><td>1</td><td>99</td></tr>
  <tr><td>Plus</td><td>3</td><td>199</td></tr>
</table>` },
    { id: 'css-card', title: 'CSS: a card', text:
`.card {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border: 1px solid #d0d7de;
  border-radius: 12px;
}
.card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); }
@media (max-width: 600px) { .card { flex-direction: column; } }` },
    { id: 'sql-select', title: 'SQL: a report query', text:
`SELECT c.city, COUNT(*) AS orders, SUM(o.amount) AS total
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.created_at >= '2026-04-01'
GROUP BY c.city
HAVING SUM(o.amount) > 50000
ORDER BY total DESC;` },
    { id: 'sql-update', title: 'SQL: create and update', text:
`CREATE TABLE stock (
  code INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  qty INTEGER DEFAULT 0
);
INSERT INTO stock (code, name, qty) VALUES (1104, 'Rice 25 kg', 42);
UPDATE stock SET qty = qty - 5 WHERE code = 1104;` },
  ],
};

const business = {
  id: 'business',
  title: 'Business writing',
  description: 'Emails, notices, circulars and short reports in everyday Indian business English.',
  exercises: [
    { id: 'leave', title: 'Leave application', text:
      'Dear Sir, I request leave from 18 November to 20 November 2026 as I have to attend my cousin\'s wedding in Nagpur. I have completed the pending ledger entries and Mr. Suresh has agreed to handle the counter in my absence. Kindly grant me leave for three days. Yours faithfully, Priya Menon, Accounts Assistant.' },
    { id: 'meeting', title: 'Meeting notice', text:
      'NOTICE: The monthly review meeting of all branch heads will be held on Friday, 27 November 2026, at 3:00 pm in the conference hall, second floor. Agenda: sales for October, collection of dues, and the new billing software. Please bring your branch figures. Attendance is compulsory. - Office of the General Manager' },
    { id: 'quotation', title: 'Request for quotation', text:
      'Dear Sir/Madam, We are interested in buying 40 office chairs with arm rests and 10 workstations for our new office in Hyderabad. Please send your best quotation, including GST, delivery charges and warranty terms, by 5 December 2026. Kindly also mention the time needed for delivery. Regards, Purchase Department, Sunrise Traders.' },
    { id: 'reminder', title: 'Payment reminder', text:
      'Dear Mr. Bansal, This is a gentle reminder that our invoice no. ST/2026/312 dated 10 October 2026 for Rs. 46,800 is still unpaid. The due date was 9 November. We request you to arrange the payment at the earliest. If you have already paid, please ignore this mail and share the transaction details. Thank you.' },
    { id: 'order', title: 'Order confirmation', text:
      'Dear Customer, Thank you for your order no. 55871. We confirm the supply of 200 cartons of printing paper at the agreed rate. The goods will be dispatched from our Bhiwandi godown on 2 December and should reach you within four working days. The invoice and e-way bill will be sent with the consignment.' },
    { id: 'circular', title: 'Circular to staff', text:
      'CIRCULAR: All employees are informed that office timings will be 9:30 am to 6:00 pm from 1 December 2026. The lunch break will be from 1:30 pm to 2:00 pm. Staff must mark attendance on the new biometric machine at the entrance. Department heads are requested to inform their teams. - Human Resources' },
    { id: 'report', title: 'Monthly sales report', text:
      'Sales for October 2026 were Rs. 18.4 lakh, an increase of 12 percent over September. The Pune and Nashik branches crossed their targets, while Aurangabad remained 8 percent short because of the festival holidays. Collections improved to 91 percent. We recommend two more field staff for Aurangabad before the year-end season.' },
    { id: 'apology', title: 'Apology for delay', text:
      'Dear Ms. Fernandes, We sincerely apologise for the delay in delivering your order. A breakdown of our delivery van near Belagavi held up the consignment by two days. The goods have now been dispatched and will reach you tomorrow before noon. As a goodwill gesture, we have waived the freight charges on this order.' },
    { id: 'offer', title: 'Accepting a job offer', text:
      'Dear Mr. Iyer, Thank you for your letter dated 12 November offering me the post of Office Executive at a monthly salary of Rs. 28,000. I am happy to accept the offer and will join on 1 December 2026 as discussed. I will bring the documents listed in the letter on my first day. I look forward to working with your team.' },
    { id: 'complaint', title: 'Reply to a complaint', text:
      'Dear Sir, We have received your complaint about the faulty water purifier installed on 3 November. Our service engineer, Mr. Anil, will visit your home on Saturday between 10 am and 1 pm. If the unit cannot be repaired on the spot, it will be replaced free of cost under warranty. We regret the trouble caused to you.' },
    { id: 'minutes', title: 'Minutes of a meeting', text:
      'Minutes of the staff meeting held on 14 November 2026. Present: Mr. Rao (chair), Ms. Khan, Mr. Das, Ms. Pillai. 1. The new billing software will go live on 1 December. 2. Training sessions will be held on 25 and 26 November. 3. Ms. Khan will prepare the user guide. The meeting ended with a vote of thanks.' },
    { id: 'holiday', title: 'Holiday notice', text:
      'NOTICE: The office will remain closed on 25 December 2026 on account of Christmas. Work will resume as usual on 26 December. Customers may continue to place orders through our website, and these will be processed on the next working day. We wish all our customers and staff a happy festive season. - Management' },
  ],
};

const exam = {
  id: 'exam',
  title: 'Exam passages',
  description: 'Paragraphs of about 300 words on general topics, in the style of SSC and clerk typing tests.',
  exercises: [
    { id: 'trees', title: 'Trees in our towns', text:
      'Trees are among the oldest friends of human beings, yet in our growing towns they are often the first to be removed. When a road is widened or a new building comes up, the old neem or banyan that gave shade for decades is cut down in a single afternoon. We rarely stop to count what is lost. A large tree cools the air around it, holds the soil together during heavy rain and gives shelter to birds, squirrels and countless insects. It also gives people a place to rest, to meet and to talk. In many villages the most important decisions were once taken under a big tree in the centre of the settlement. Studies in several cities have shown that streets lined with trees can be a few degrees cooler in summer than streets without them. This matters more every year as summers become hotter. Trees also absorb dust and some of the harmful gases released by vehicles, so they help the people who live near busy roads. Planting a sapling is easy, but caring for it is not. Many saplings planted with great ceremony on special days dry up within a few weeks because nobody waters them. A better plan is for each family, school or office to adopt a few trees and look after them for at least three years, until they can survive on their own. Local bodies can help by choosing native species that suit the soil and climate, and by protecting young trees with simple guards. When development is planned with care, old trees can often be saved by changing the line of a road or the shape of a building. A town that values its trees is a town that values the health and comfort of its people.' },
    { id: 'payments', title: 'Digital payments in small towns', text:
      'A few years ago most small shops in our towns accepted only cash. Today it is common to see a printed code near the counter of a tea stall, a vegetable cart or a medical store, and customers pay by scanning it with their phones. This change has come about very quickly and has made daily life easier for many people. Shopkeepers no longer need to keep large amounts of change, and customers do not have to worry about carrying exact money. Payments are recorded automatically, which helps small traders keep track of their sales and apply for loans from banks. For people who receive wages or government support directly into their bank accounts, digital payments save the trouble of visiting the bank to withdraw cash. At the same time, the change has brought new problems. Many elderly people and those who cannot read well find it difficult to use payment apps. Some people have lost money to fraud because they shared a secret code with a stranger who called them pretending to be from a bank. Poor mobile networks in some areas mean that a payment may fail at the very moment it is needed. For digital payments to truly serve everyone, these problems must be addressed. Banks and local bodies can hold simple training camps in markets and village halls. Families can help older members learn the basic steps and the most important rule, which is never to share a PIN or a one-time password with anyone. Cash should also remain an accepted option, so that nobody is left out. Used wisely, digital payments can save time, reduce the risk of theft and bring more people into the formal banking system.' },
    { id: 'roads', title: 'Road safety', text:
      'Every year a very large number of people lose their lives in road accidents in our country, and many more are seriously injured. Behind each of these numbers is a family that has lost a parent, a child or a friend. Most of these accidents are not caused by bad luck but by habits that can be changed. Speeding is one of the main causes. Drivers often believe that a few minutes saved are worth the risk, but at higher speed a vehicle needs much more distance to stop, and a small mistake becomes a serious crash. Riding a two-wheeler without a helmet, or driving a car without wearing a seat belt, greatly increases the chance of a severe injury. Using a mobile phone while driving takes the eyes and the mind away from the road for several seconds at a time. Drunken driving remains a major problem, especially at night. Pedestrians are also at risk, because footpaths are often missing or occupied by shops and parked vehicles, which forces people to walk on the road itself. Improving road safety needs effort from everyone. Drivers must follow speed limits, wear helmets and seat belts and keep their phones away. Parents should set a good example for their children, who learn more from what they see than from what they are told. Schools can teach young students how to cross roads safely. Authorities can improve road design, mark zebra crossings clearly, keep footpaths free and repair street lights. Strict and fair enforcement of traffic rules also helps. A safe journey is not a matter of chance. It is the result of patience, care and respect for the lives of others who share the road.' },
    { id: 'water', title: 'Saving water', text:
      'Water is so much a part of our daily life that we often forget how precious it is. We use it to drink, cook, wash, grow food and run factories, and we expect it to flow whenever we open a tap. Yet in many parts of the country, wells are drying up and people have to wait for tankers during the summer months. The level of water under the ground is falling in several districts because more water is being pumped out than the rain can put back. Saving water does not always require large projects. Small actions taken by many people can make a real difference. A dripping tap can waste many litres in a single day, so leaks should be repaired quickly. Bathing with a bucket instead of a shower, closing the tap while brushing teeth and reusing the water from washing vegetables for plants are simple habits that every household can adopt. Farmers can save a great deal of water by using drip irrigation and by choosing crops that suit the rainfall of their area. Rainwater harvesting is another useful method. Rain that falls on rooftops can be collected and stored in tanks, or guided into pits so that it soaks into the ground and raises the water table. Many cities now require new buildings to include such systems. Old ponds and tanks in villages, which were once carefully maintained by the community, should be cleaned and protected from encroachment. Industries must treat their waste water before releasing it, so that rivers and lakes remain usable. If each of us treats water as a shared resource rather than an unlimited supply, there will be enough for our needs and for the generations that come after us.' },
    { id: 'libraries', title: 'The value of a library', text:
      'A public library is one of the most useful institutions a town can have, yet it is often ignored. For a small yearly fee, or sometimes for nothing at all, a member can read hundreds of books, newspapers and magazines that would be too costly to buy. For students preparing for competitive examinations, a quiet reading room with good light and a supply of reference books can make a great difference. Many successful candidates from poor families have said that they studied for years in their local library because their homes were too small and too noisy. A library is also a place where people of different ages and backgrounds meet. Retired people read the morning papers, children discover story books and young job seekers look through notices and guides. In this way a library helps to build a habit of reading in the whole community. Some people believe that libraries are no longer needed because so much information is available on mobile phones. It is true that the internet is very useful, but it is also full of material that is shallow, wrong or written only to attract attention. A good library offers books that have been carefully chosen, and librarians who can guide readers to the right sources. Many libraries now also provide computers and internet access, which is helpful for those who cannot afford their own. To keep libraries alive, local bodies must give them enough funds for new books, clean furniture and trained staff. Readers too have a duty to return books on time and in good condition. A town that supports its library invests in the minds of its people, and that investment pays back many times over.' },
    { id: 'railways', title: 'Travelling by train', text:
      'For millions of people the railways are the most important means of travel in our country. Every day trains carry office workers to cities, students to colleges, farmers to markets and families to weddings and festivals in distant towns. A long train journey has a character of its own. Passengers share food, stories and newspapers with strangers who soon become companions, and the view from the window changes from green fields to rocky hills and wide rivers. The railways also carry coal, grain, cement and many other goods, which helps keep prices lower than they would be if everything moved by road. Over the years many changes have made train travel easier. Tickets can now be booked online or through mobile apps, and passengers receive messages about their seat and the running status of the train. Many stations have been cleaned and improved, with better waiting rooms, lifts and drinking water. Faster trains have reduced the travel time between several large cities. Still, much remains to be done. During festivals and holidays it is very hard to get a confirmed seat, and general coaches are often overcrowded. Cleanliness inside coaches and toilets depends a great deal on the behaviour of passengers. Safety at unmanned crossings and on old bridges needs constant attention. Passengers can play their part by keeping coaches clean, not pulling the alarm chain without reason, respecting the reserved seats of others and taking care of public property. The railways belong to all of us. When we treat them with care, they continue to serve the country well, linking its people and its regions in a way that few other services can.' },
    { id: 'health', title: 'Exercise and daily health', text:
      'Modern life has made many tasks easier, but it has also made many of us less active. People who once walked to work or to the market now travel by motorcycle or bus, and a large part of the day is spent sitting in front of a computer or a mobile phone. This lack of movement, together with food that is rich in sugar, salt and oil, has led to a rise in problems such as obesity, diabetes, high blood pressure and back pain, even among young people. The good news is that regular exercise does not need expensive equipment or a membership at a gym. A brisk walk of thirty minutes on most days of the week can improve the health of the heart, control weight and lift the mood. Simple stretching, yoga or a game of football or kabaddi with friends are equally useful. What matters most is regularity. A little exercise every day is far better than a long session once a month. Those who work at a desk should stand up and move for a few minutes every hour, and should keep the screen at eye level to protect the neck and back. Sleep is another part of good health that is often neglected. Staying awake late at night with a phone leaves the body tired and the mind restless the next day. Food habits also matter. Home cooked meals with plenty of vegetables, pulses and fruit are better than packaged snacks. Drinking enough water and cutting down on sweet drinks helps too. Good health is not a matter of luck alone. It is built slowly, through small choices made every day, and it is the foundation for success in study, work and family life.' },
    { id: 'business', title: 'Small businesses and local jobs', text:
      'Small businesses form the backbone of our economy. The grocery shop at the corner, the tailor in the market, the repair shop near the bus stand and the family that makes pickles at home and sells them in nearby towns all provide goods, services and jobs to a large number of people. Together, small and medium enterprises employ more people than large factories, and they are often the first place where young people learn a trade. These businesses face many difficulties. They usually have little money to spare, so a delay in payment from a customer can make it hard to pay wages or buy raw material. Getting a loan from a bank can be slow because the owners may not have proper accounts or property to offer as security. Competition from large companies and online sellers has also increased. Despite these problems, many small businesses have found new ways to grow. Some have started selling through websites and messaging apps, reaching customers far beyond their own town. Others have joined together in groups to buy raw material in bulk at lower prices. Simple accounting software and digital payments have helped owners keep better records, which in turn makes it easier to get credit. The government has several schemes that offer training, loans at lower interest and help with marketing, but many owners are not aware of them. Local trade bodies and banks can do more to spread information about these schemes. As customers, we can support small businesses by buying from them when we can, paying them on time and recommending them to others. When local businesses do well, money stays within the community, jobs are created close to home and the whole town benefits.' },
  ],
};

export const PACKS = [numbers, code, business, exam];
export const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));

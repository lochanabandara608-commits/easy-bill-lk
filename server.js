const express=require("express"),session=require("express-session"),bcrypt=require("bcryptjs"),Database=require("better-sqlite3"),path=require("path");
const app=express(),PORT=process.env.PORT||3000,db=new Database(process.env.DB_PATH||"easybill.db");
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category TEXT DEFAULT '',buy_price REAL DEFAULT 0,sell_price REAL DEFAULT 0,stock INTEGER DEFAULT 0,reorder_level INTEGER DEFAULT 5,expiry TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_no TEXT UNIQUE NOT NULL,user_id INTEGER,total REAL NOT NULL,payment_method TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sale_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,sale_id INTEGER,item_id INTEGER,qty INTEGER,unit_price REAL);
CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,po_no TEXT UNIQUE NOT NULL,supplier TEXT,total REAL,user_id INTEGER,status TEXT DEFAULT 'Received',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
if(!db.prepare("SELECT COUNT(*) c FROM users").get().c){
 const add=db.prepare("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)");
 add.run("System Administrator","admin",bcrypt.hashSync("admin123",12),"Administrator");
 add.run("Shop Manager","manager",bcrypt.hashSync("manager123",12),"Manager");
 add.run("POS Cashier","cashier",bcrypt.hashSync("cashier123",12),"Cashier");
}
if(!db.prepare("SELECT COUNT(*) c FROM items").get().c){
 const add=db.prepare("INSERT INTO items(code,name,category,buy_price,sell_price,stock,reorder_level,expiry) VALUES(?,?,?,?,?,?,?,?)");
 [["ITM001","Coca Cola 500ml","Drinks",110,150,42,10,"2026-10-30"],["ITM002","Pepsi 500ml","Drinks",105,145,28,10,"2026-09-15"],["ITM003","Rice 5kg","Grocery",1050,1190,7,5,"2027-04-01"],["ITM004","Milk Powder 400g","Grocery",480,550,4,8,"2026-09-01"],["ITM005","Biscuit Pack","Snacks",95,130,65,15,"2026-12-10"]].forEach(x=>add.run(...x));
}
app.use(express.json());app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"easy-bill-change-me",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production"}}));
app.use(express.static(path.join(__dirname,"public")));
const roles={Administrator:9,Manager:6,Cashier:2};
const auth=(req,res,next)=>req.session.user?next():res.status(401).json({error:"Not signed in"});
const allow=r=>(req,res,next)=>req.session.user&&roles[req.session.user.role]>=roles[r]?next():res.status(403).json({error:"Permission denied"});
const audit=(u,a)=>db.prepare("INSERT INTO audit_logs(user_id,action) VALUES(?,?)").run(u,a);

app.get("/api/session",(q,s)=>s.json({user:q.session.user||null,shop:process.env.SHOP_NAME||"Easy Bill LK"}));
app.post("/api/login",async(q,s)=>{const u=db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(q.body.username);if(!u||!(await bcrypt.compare(q.body.password,u.password_hash)))return s.status(401).json({error:"Invalid username or password"});q.session.user={id:u.id,name:u.name,username:u.username,role:u.role};audit(u.id,"Logged in");s.json({user:q.session.user})});
app.post("/api/logout",auth,(q,s)=>q.session.destroy(()=>s.json({ok:true})));

app.get("/api/dashboard",auth,(q,s)=>{
 const today=db.prepare("SELECT COALESCE(SUM(total),0) total,COUNT(*) invoices FROM sales WHERE date(created_at)=date('now','localtime')").get();
 const stock=db.prepare("SELECT COALESCE(SUM(buy_price*stock),0) value,COUNT(*) sku,COALESCE(SUM(stock),0) units FROM items").get();
 const low=db.prepare("SELECT COUNT(*) c FROM items WHERE stock<=reorder_level").get().c;
 const exp=db.prepare("SELECT COUNT(*) c FROM items WHERE expiry<>'' AND date(expiry)<=date('now','localtime','+30 day')").get().c;
 s.json({today,stock,low,exp,recent:db.prepare("SELECT s.invoice_no,s.total,s.payment_method,s.created_at,u.username FROM sales s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 10").all()});
});
app.get("/api/items",auth,(q,s)=>s.json(db.prepare("SELECT * FROM items ORDER BY id DESC").all()));
app.post("/api/items",allow("Manager"),(q,s)=>{try{const x=q.body,r=db.prepare("INSERT INTO items(code,name,category,buy_price,sell_price,stock,reorder_level,expiry) VALUES(?,?,?,?,?,?,?,?)").run(x.code,x.name,x.category||"",+x.buy_price||0,+x.sell_price||0,+x.stock||0,+x.reorder_level||5,x.expiry||"");audit(q.session.user.id,"Created item "+x.name);s.json({id:r.lastInsertRowid})}catch(e){s.status(400).json({error:"Item code already exists"})}});
app.post("/api/sales",auth,(q,s)=>{
 const lines=q.body.items||[];if(!lines.length)return s.status(400).json({error:"Cart is empty"});
 const get=db.prepare("SELECT * FROM items WHERE id=?");let total=0,checked=[];
 for(const l of lines){const i=get.get(l.item_id),qty=+l.qty;if(!i||qty<1||i.stock<qty)return s.status(400).json({error:"Insufficient stock"});total+=i.sell_price*qty;checked.push({i,qty})}
 const invoice="INV-"+Date.now(),tx=db.transaction(()=>{const sale=db.prepare("INSERT INTO sales(invoice_no,user_id,total,payment_method) VALUES(?,?,?,?)").run(invoice,q.session.user.id,total,q.body.payment_method||"Cash");const sl=db.prepare("INSERT INTO sale_lines(sale_id,item_id,qty,unit_price) VALUES(?,?,?,?)"),up=db.prepare("UPDATE items SET stock=stock-? WHERE id=?");for(const x of checked){sl.run(sale.lastInsertRowid,x.i.id,x.qty,x.i.sell_price);up.run(x.qty,x.i.id)}});
 tx();audit(q.session.user.id,"Completed sale "+invoice);s.json({invoice,total});
});
app.get("/api/sales",auth,(q,s)=>s.json(db.prepare("SELECT s.*,u.username FROM sales s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100").all()));
app.get("/api/purchases",auth,(q,s)=>s.json(db.prepare("SELECT p.*,u.username FROM purchases p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC").all()));
app.post("/api/purchases",allow("Manager"),(q,s)=>{const po="PO-"+Date.now();db.prepare("INSERT INTO purchases(po_no,supplier,total,user_id) VALUES(?,?,?,?)").run(po,q.body.supplier,+q.body.total||0,q.session.user.id);audit(q.session.user.id,"Created purchase "+po);s.json({po})});
app.get("/api/users",allow("Administrator"),(q,s)=>s.json(db.prepare("SELECT id,name,username,role,active,created_at FROM users ORDER BY id DESC").all()));
app.post("/api/users",allow("Administrator"),async(q,s)=>{try{const x=q.body,r=db.prepare("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)").run(x.name,x.username,await bcrypt.hash(x.password,12),x.role);audit(q.session.user.id,"Created user "+x.username);s.json({id:r.lastInsertRowid})}catch(e){s.status(400).json({error:"Username already exists"})}});
app.get("/api/reports",allow("Manager"),(q,s)=>s.json({sales:db.prepare("SELECT COALESCE(SUM(total),0) total,COUNT(*) invoices FROM sales").get(),purchases:db.prepare("SELECT COALESCE(SUM(total),0) total FROM purchases").get(),profit:db.prepare("SELECT COALESCE(SUM(sl.qty*(sl.unit_price-i.buy_price)),0) value FROM sale_lines sl JOIN items i ON i.id=sl.item_id").get()}));
app.get("/api/audit",allow("Administrator"),(q,s)=>s.json(db.prepare("SELECT a.created_at,a.action,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200").all()));
app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Easy Bill LK running on "+PORT));

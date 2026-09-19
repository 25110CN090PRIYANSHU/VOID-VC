require("dotenv").config();
const express=require("express");
const http=require("http");
const path=require("path");
const cors=require("cors");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const mongoose=require("mongoose");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
const PORT=process.env.PORT||5000;
const JWT_SECRET=process.env.JWT_SECRET||"void-vc-dev-secret";

app.use(cors());
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

let dbReady=false;
const UserSchema=new mongoose.Schema({
  name:{type:String,required:true,trim:true,maxlength:40},
  email:{type:String,required:true,unique:true,lowercase:true,trim:true},
  password:String,
  avatar:String,
  createdAt:{type:Date,default:Date.now}
});
const MeetingSchema=new mongoose.Schema({
  roomId:String,title:String,hostName:String,hostId:String,startedAt:Date,endedAt:Date
});
let User=null, Meeting=null;
async function initDb(){
  if(!process.env.MONGO_URI) return;
  try{
    await mongoose.connect(process.env.MONGO_URI);
    User=mongoose.model("User",UserSchema);
    Meeting=mongoose.model("Meeting",MeetingSchema);
    dbReady=true;
    console.log("MongoDB connected");
  }catch(e){console.log("MongoDB unavailable:",e.message)}
}
initDb();

const memoryUsers=new Map();
const memoryMeetings=[];
function tokenFor(u){return jwt.sign({id:u._id||u.id,email:u.email,name:u.name},JWT_SECRET,{expiresIn:"7d"})}
function safeUser(u){return {id:u._id||u.id,name:u.name,email:u.email,avatar:u.avatar||""}}

app.get("/api/health",(req,res)=>res.json({ok:true,db:dbReady,service:"VOID VC"}));

app.post("/api/auth/signup",async(req,res)=>{
  const {name,email,password}=req.body||{};
  if(!name||!email||!password||password.length<6) return res.status(400).json({message:"Name, email and password (6+ characters) are required."});
  try{
    let existing=dbReady?await User.findOne({email:email.toLowerCase()}):memoryUsers.get(email.toLowerCase());
    if(existing) return res.status(409).json({message:"An account with this email already exists."});
    const hash=await bcrypt.hash(password,10);
    const u=dbReady?await User.create({name,email:email.toLowerCase(),password:hash}):{id:crypto.randomUUID(),name,email:email.toLowerCase(),password:hash};
    if(!dbReady) memoryUsers.set(u.email,u);
    res.json({user:safeUser(u),token:tokenFor(u)});
  }catch(e){res.status(500).json({message:"Signup failed."})}
});

app.post("/api/auth/login",async(req,res)=>{
  const {email,password}=req.body||{};
  try{
    const u=dbReady?await User.findOne({email:email?.toLowerCase()}):memoryUsers.get(email?.toLowerCase());
    if(!u||!(await bcrypt.compare(password||"",u.password))) return res.status(401).json({message:"Invalid email or password."});
    res.json({user:safeUser(u),token:tokenFor(u)});
  }catch(e){res.status(500).json({message:"Login failed."})}
});

function auth(req,res,next){
  const h=req.headers.authorization||"";
  try{req.user=jwt.verify(h.replace("Bearer ",""),JWT_SECRET);next()}
  catch(e){res.status(401).json({message:"Authentication required."})}
}
app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));

app.get("/api/meetings",auth,async(req,res)=>{
  if(dbReady) return res.json(await Meeting.find({hostId:String(req.user.id)}).sort({startedAt:-1}).limit(30));
  res.json(memoryMeetings.filter(m=>m.hostId===String(req.user.id)).slice(-30).reverse());
});

const rooms=new Map();
const socketInfo=new Map();

function roomData(roomId){
  if(!rooms.has(roomId)) rooms.set(roomId,{locked:false,password:null,hostSocket:null,hostName:"Host",title:"VOID VC Meeting",participants:new Map()});
  return rooms.get(roomId);
}
function publicParticipants(r){
  return [...r.participants.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar||"",host:p.host,muted:p.muted,camera:p.camera,hand:p.hand}));
}

io.on("connection",socket=>{
  socket.on("join-room",async({roomId,name,avatar,password,title,userId})=>{
    roomId=String(roomId||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,40);
    if(!roomId)return socket.emit("join-error","Invalid room ID.");
    const r=roomData(roomId);
    if(r.locked && r.password && password!==r.password)return socket.emit("join-error","This room is locked or the password is incorrect.");
    if(r.participants.size>=12)return socket.emit("join-error","This room is full (12 participant limit).");
    const host=!r.hostSocket;
    if(host){r.hostSocket=socket.id;r.hostName=name||"Host";if(title)r.title=title;if(password)r.password=password;}
    const p={id:socket.id,name:name||"Guest",avatar:avatar||"",host,muted:false,camera:true,hand:false};
    r.participants.set(socket.id,p); socketInfo.set(socket.id,{roomId});
    socket.join(roomId);
    socket.emit("room-state",{roomId,title:r.title,hostId:r.hostSocket,participants:publicParticipants(r),you:p});
    socket.to(roomId).emit("participant-joined",p);
    io.to(roomId).emit("participants",publicParticipants(r));
    if(dbReady&&host) await Meeting.create({roomId,title:r.title,hostName:p.name,hostId:String(userId||p.id),startedAt:new Date()}).catch(()=>{});
  });

  socket.on("signal",({to,data})=>io.to(to).emit("signal",{from:socket.id,data}));
  socket.on("chat",({roomId,name,message})=>io.to(roomId).emit("chat",{name:String(name||"Guest").slice(0,40),message:String(message||"").slice(0,1000),time:Date.now()}));
  socket.on("state",({roomId,muted,camera,hand})=>{
    const r=rooms.get(roomId),p=r?.participants.get(socket.id); if(!p)return;
    if(typeof muted==="boolean")p.muted=muted;if(typeof camera==="boolean")p.camera=camera;if(typeof hand==="boolean")p.hand=hand;
    io.to(roomId).emit("participants",publicParticipants(r));
  });
  socket.on("lock-room",({roomId,locked})=>{
    const r=rooms.get(roomId); if(!r||r.hostSocket!==socket.id)return;
    r.locked=!!locked;io.to(roomId).emit("room-locked",r.locked);
  });
  socket.on("kick",({roomId,target})=>{
    const r=rooms.get(roomId); if(!r||r.hostSocket!==socket.id)return;
    io.to(target).emit("kicked"); const t=r.participants.get(target); if(t)io.to(roomId).emit("system",`${t.name} was removed by the host.`);
    io.sockets.sockets.get(target)?.leave(roomId);r.participants.delete(target);io.to(roomId).emit("participants",publicParticipants(r));
  });
  socket.on("leave",()=>leave(socket));
  socket.on("disconnect",()=>leave(socket));
});

function leave(socket){
  const info=socketInfo.get(socket.id);if(!info)return;
  const r=rooms.get(info.roomId);if(!r)return;
  const p=r.participants.get(socket.id);r.participants.delete(socket.id);socket.to(info.roomId).emit("participant-left",{id:socket.id,name:p?.name||"Guest"});
  if(r.hostSocket===socket.id){const next=r.participants.keys().next().value;r.hostSocket=next;if(next){const np=r.participants.get(next);np.host=true;io.to(next).emit("became-host");}}
  io.to(info.roomId).emit("participants",publicParticipants(r));
  if(!r.participants.size)rooms.delete(info.roomId);
  socketInfo.delete(socket.id);
}

app.use((req,res)=>{
  if(req.method==="GET" && !req.path.startsWith("/api/")){
    return res.sendFile(path.join(__dirname,"public","index.html"));
  }
  res.status(404).json({message:"Not found"});
});
server.listen(PORT,()=>console.log(`VOID VC running on http://localhost:${PORT}`));

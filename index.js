const express = require('express')
const cors = require('cors')
require('dotenv').config()
const mongoose = require('mongoose')
const cookieParser = require('cookie-parser')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const socketio = require('socket.io')

const app = express()
const server = require('http').Server(app)
const io = socketio(server, {cors: {origin: "http://localhost:5173",methods: ["GET", "POST"]}});

app.use(express.json())
app.use(cors({origin : 'http://localhost:5173'}))
app.use(cookieParser())

mongoose.connect(process.env.MONGODB_URI)
    .then(()=>console.log('DB connected'))
    .catch((err)=>console.log(err))

const task = new mongoose.Schema({
    Name : {type : String,required : true,unique : true},
    Phone : {type : String,required : true},
    Notes : {type : String,required : true},
    Status : {type:String,default:"Not assigned",enum:['Not assigned','Not started','In progress','Struck in error','Completed']},
    Agent : {type:mongoose.Schema.Types.ObjectId,ref:'Agent'},
    createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'Admin'}
})
const Task = mongoose.model('tasks', task)
const agent = new mongoose.Schema({
    Name : {type : String,required : true},
    email : {type : String,required : true},
    Phone : {type : String,required : true},
    pwd : {type : String,required : true},
    tasks : [{type : mongoose.Schema.Types.ObjectId, ref :'Task'}],
    Admin:{type:mongoose.Schema.Types.ObjectId,ref:'Admin'}
})
const Agent = mongoose.model('agents', agent)
const admin = new mongoose.Schema({
    Name : {type : String,unique : true,required : true},
    email : {type : String,unique : true,required : true},
    pwd : {type : String,required : true},
    agents : [{type : mongoose.Schema.Types.ObjectId,ref:'Agent'}],
    tasks : [{type:mongoose.Schema.Types.ObjectId,ref:'Task'}],
})
const Admin = mongoose.model('admins',admin)

app.post('/', async (req, res) => {
    try {
        const { token } = req.body;
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return res.status(400).json({ message: "Token verification failed" });
            }
            const { email,role } = decoded
            if (role === 'Admin') {
                try {
                    const admin = await Admin.findOne({email})
                    const tasks = await Task.find({ createdBy: admin._id }).lean()
                    const agents = await Agent.find({ Admin: admin._id }).lean()
                    return res.status(200).json({admin, role: 'Admin',tasks,agents})
                } catch (dbError) {
                    return res.status(500).json()
                }
            } else {
                try {
                    const agent = await Agent.findOne({email}).lean()
                    if (!agent) {
                        return res.status(404).json()
                    }
                    const tasks = await Task.find({ Agent: agent._id })
                    return res.status(200).json({agent: { ...agent, tasks: tasks }, role: 'Agent' })
                } catch (agentError) {
                    return res.status(500).json()
                }
            }
        })
    } catch (err) {
        return res.status(500).json({ message: "Internal server error" });
    }
})
app.post('/Login',async(req,res)=>{
    try {
        const {  type,email, pwd } = req.body
        if(type === "Admin"){
            const admin = await Admin.findOne({ email })
            const match = await bcrypt.compare(pwd,admin.pwd)
            if(!match){
                return res.status(400).json({message : "Details not match"})
            }
            const token = await jwt.sign({ email: email, role: 'Admin'}, process.env.JWT_SECRET,{expiresIn : '1d'})
            return res.status(200).json({message : "Login success",token : token,role:'Admin'})
        }
        else{
            const agent = await Agent.findOne({email})
            const match = await bcrypt.compare(pwd,agent.pwd)
            if(!match){
                return res.status(400).json({ message: "Details not match" })
            }
            const token = await jwt.sign({ email: email,role : 'Agent' }, process.env.JWT_SECRET, { expiresIn: '7d' })
            return res.status(200).json({ message: "Login success", token: token,role:'agent' })
        }
    }
    catch (err) {
        return res.status(500).json({message : "Internal server error"})
    }
})
app.post('/Register',async(req,res)=>{
    try{
    const {uname, email, pwd} = req.body
    const salt = await bcrypt.genSalt(10)
    const hashedPwd = await bcrypt.hash(pwd,salt)
    const user = await new Admin({Name : uname,email : email,pwd : hashedPwd}).save()
    if(!user){
        return res.status(400).json({message : "Error in registering"})
    }
    return res.status(200).json({message : "Successfully registered"})
    }
    catch(err){
        return res.status(500).json({message : "internal server error"})
    }
})
app.post('/CRUD_Agent',async(req,res)=>{
    const {type} = req.body
    if(type === 'create'){
        try{
        const { admin, uname, email, phone, pwd } = req.body
        const salt = await bcrypt.genSalt(10)
        const hashedPwd = await bcrypt.hash(pwd,salt)
        const adminFound = await Admin.findById(admin)
        if(!adminFound){
            return res.status(400).json()
        }
        const agent = await new Agent({Name:uname,email:email,Phone:phone,pwd:hashedPwd,Admin:adminFound._id}).save()
        await Admin.findByIdAndUpdate(adminFound._id,{$push:{agents:agent._id}})
        if(!agent){
            return res.status(400).json()
        }
        return res.status(200).json({agent})
        }
        catch(err){
            return res.status(500).json()
        }
    }
    else if(type === 'update'){
        try{
            const {agent} = req.body
            const updatedAgent = await Agent.findByIdAndUpdate(agent.Id,
                {Name:agent.Name,Phone:agent.Phone,email:agent.email},{new:true})
            if(!updatedAgent){
                return res.status(400).json()
            }
            return res.status(200).json({agent:updatedAgent})
        }
        catch(err){
            return res.status(500).json()
        }
    }
    else if(type === 'delete'){
        try{
        const {Id} = req.body
        const deletedAgent = await Agent.findByIdAndDelete(Id)
        await Admin.findByIdAndUpdate(deletedAgent.Admin,{$pull:{agents:deletedAgent._id}})
        if(!deletedAgent){
            return res.status(400).json({message:"error"})
        }
        return res.status(200).json({message:"success"})
        }

    catch(err){return res.status(500).json()}
    }
})
app.post('/CRUD_Task',async(req,res)=>{
    const {type} = req.body
    if(type === 'create'){
        const { admin, name, phone, notes } = req.body
        const task = await new Task({Name:name,Phone:phone,Notes:notes,createdBy:admin}).save()
        if(!task){
            return res.status(400).json()
        }
        return res.status(200).json({task})
    }
    else if(type === 'insert multiple tasks'){
        try{
            const {admin,tasks} = req.body
            const updatedTasks = tasks.map((task)=> ({...task,createdBy:admin}))
            const newTasks = await Task.insertMany(updatedTasks)
            if(!newTasks){
                return res.status(400).json()
            }
            const taskIds = newTasks.map((task)=> task._id)
            const updatedAdmin = await Admin.findByIdAndUpdate(admin,{$push:{tasks:taskIds}},{new:true})
            return res.status(200).json({ tasks: newTasks, taskIds: updatedAdmin.tasks })
        }
        catch(err){console.log(err)
            return res.status(500).json()}
    }
    else if(type === 'update'){
        try{
        const {task} = req.body
        const updatedTask = await Task.findByIdAndUpdate(task._id,{Name:task.Name,Phone:task.Phone,Notes:task.Notes},{new:true})
        if(!updatedTask){
            return res.status(400).json()
        }
        return res.status(200).json({task:updatedTask})
        }
    catch(err){console.log(err)
        return res.status(500).json()}
    }
    else if (type === 'update and assign'){
        const { task, assignTo } = req.body
        const updatedTask = await Task.findByIdAndUpdate(task._id, {Name: task.Name,
            Phone: task.Phone, Notes: task.Notes, Status:'Not started',Agent:assignTo },{new:true})
        if(!updatedTask){ return res.status(400).json() }

        await Agent.findByIdAndUpdate(assignTo,{$push:{tasks:updatedTask._id}})
        await Admin.findByIdAndUpdate(updatedTask.createdBy,{$pull:{tasks:updatedTask._id}})
        return res.status(200).json({task:updatedTask})
    }
    else if(type === 'assign all tasks'){
        const {admin} = req.body
        const unassignedTasks = await Task.find({createdBy:admin,Agent:null})
        const agents = await Agent.find({Admin:admin})
        const len = agents.length
        if(len == 0){
            return res.status(400).json()
        }
        let agentIndex = 0
        const taskUpdates = []
        const agentTaskMap = new Map()

        for (const task of unassignedTasks){
            const assignedAgent = agents[agentIndex]
            taskUpdates.push({
                updateOne : { filter: {_id:task._id},update:{Status:'Not started',Agent:assignedAgent._id}}
            })
            if(!agentTaskMap.has(assignedAgent._id)){
                agentTaskMap.set(assignedAgent._id, [])
            }
            agentTaskMap.get(assignedAgent._id).push(task._id)
            agentIndex = (agentIndex + 1) % len
        }
        if (taskUpdates.length > 0) {
            await Task.bulkWrite(taskUpdates);
        }
        const agentUpdates = [];
        for (const [agentId, taskIds] of agentTaskMap.entries()) {
            agentUpdates.push({
                updateOne: {
                    filter: { _id: agentId },
                    update: { $push: { tasks: { $each: taskIds } } }
                }
            });
        }

        if (agentUpdates.length > 0) {
            await Agent.bulkWrite(agentUpdates);
        }
        const updatedTasks = await Task.find({ createdBy: admin });
        const updatedAgents = await Agent.find({ Admin: admin });
        await Admin.findByIdAndUpdate(admin,{tasks:[]})
        return res.status(200).json({tasks:updatedTasks,agents:updatedAgents})
    }
    else if (type === 'update agent task') {
        try{
            const {task} = req.body
            const updatedTask = await Task.findByIdAndUpdate(task._id,
                {Name:task.Name,Phone:task.Phone,Notes:task.Notes},{new:true})
            if(!updatedTask){
                return res.status(400).json()
            }
            return res.status(200).json({task:updatedTask})
        }
        catch(err){return re.status(500).json()}
    }
    else if (type === 'update agent task and re-assign'){
        const {task,option} = req.body
        if(option == 'Not assigned'){
            try{
                await Agent.findByIdAndUpdate(task.Agent,{$pull:{tasks:task._id}},{new:true})
                await Admin.findByIdAndUpdate(task.createdBy,{$push:{tasks:task._id}},{new:true})

                const updatedTask = await Task.findByIdAndUpdate(task._id,
                    {Name:task.Name,Phone:task.Phone,Notes:task.Notes,Status:'Not assigned',Agent:null},{new:true})
                if(!updatedTask){
                    return res.status(400).json()
                }
                return res.status(200).json({task:updatedTask})
            }
            catch(err){console.log(err)
                return res.status(500).json()}
        }
        else{
            await Agent.findByIdAndUpdate(task.Agent,{$pull:{tasks:task._id}})
            await Agent.findByIdAndUpdate(option,{$push:{tasks:task._id}})
            const updatedTask = await Task.findByIdAndUpdate(task._id,
                {Name:task.Name,Phone:task.Phone,Notes:task.Notes,Agent:option},{new:true})
            if(!updatedTask){
                return res.status(400).json()
            }
            return res.status(200).json({task:updatedTask})
        }
    }
    else if (type === 'delete'){
        try{
        const {id} = req.body
        const deletedTask = await Task.findByIdAndDelete(id)
        if(!deletedTask){
            return res.status(400).json()
        }
        if(deletedTask.Agent){
            await Agent.findByIdAndUpdate(deletedTask.Agent,{$pull:{tasks:deletedTask._id}})
        }
        else{
            await Admin.findByIdAndUpdate(deletedTask.createdBy,{$pull:{tasks:deletedTask._id}})
        }
        return res.status(200).json()
        }
        catch(err){
            return res.status(500).json()
        }
    }
    else if (type === 'status update'){
        const {taskId,Status,Notes} = req.body
        const updatedTask = await Task.findByIdAndUpdate(taskId,{Status:Status,Notes:Notes},{new:true})
        if(!updatedTask){
            return res.status(400).json()
        }
        return res.status(200).json({task:updatedTask})
    }
})
const connectedUsers = {}

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    if (userId) {
        connectedUsers[userId] = socket.id; // Store mapping
        console.log(`User ${userId} connected with socket ID: ${socket.id}`);
    } else {
        console.log(`Socket ${socket.id} connected without userId`);
    }

    socket.on('sendMessage', (message) => {
        io.emit('message', message);
    });

    socket.on('disconnect', () => {
        console.log(`User ${userId} (Socket ${socket.id}) disconnected`);
        delete connectedUsers[userId]; // Remove user from mapping
    })
})

server.listen(3000, () => {
    console.log('Server running on port 3000')
});
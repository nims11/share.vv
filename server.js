var io = require('socket.io').listen(5000, {log: false});
var rooms = {};
var leaderRoom = {};
io.sockets.on('connection', function (socket) {
  socket.on('ice', function (data) {
    if(rooms[data.roomId]){
      if(socket.id != rooms[data.roomId].leader){
        data.socket = socket.id;
        io.sockets.socket(rooms[data.roomId].leader).emit('ice', data);
      }else{
        var target = data.socket;
        delete data.socket;
        io.sockets.socket(target).emit('ice', data);
      }
    }
  });
  socket.on('sdp', function (data) {
    if(rooms[data.roomId]){
      if(socket.id != rooms[data.roomId].leader){
        data.socket = socket.id;
        io.sockets.socket(rooms[data.roomId].leader).emit('sdp', data);
      }else{
        var target = data.socket;
        delete data.socket;
        io.sockets.socket(target).emit('sdp', data);
      }
    }
  });
  socket.on("createRoom", function(data) {
    var roomId;
    do{
      roomId = Math.random().toString(36).substring(2, 9);
    }while(roomId in rooms);

		rooms[roomId] = {leader: socket.id, slaves: []};
    leaderRoom[socket.id] = roomId;
		console.log('Room ' + roomId + ' created');
    socket.emit('roomAssigned', {roomId: roomId});
  });
  socket.on("joinRoom", function(data) {
  	if(rooms[data.roomId]){
  		console.log('Joined room ' + data.roomId);
      io.sockets.socket(rooms[data.roomId].leader).emit('newSlave', {"socket": socket.id});
  	}
  });
  socket.on("disconnect", function(){
    if(leaderRoom[socket.id]){
      console.log('room '+leaderRoom[socket.id]+' deleted');
      delete rooms[leaderRoom[socket.id]];
      delete leaderRoom[socket.id];
    }
  });
});
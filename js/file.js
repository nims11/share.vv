/*
    Things to implement 
                    - Redesign Queues
                        - Stopping download
                        - Removing a file from list
                        - Redownload
                        - parallel downloading
                        - serial uploading
                    - Checksum
                    - exploiting UTF-16 for tranmitting data instead of UTF-8
                    - binary data tranfer
                    - drag and drop

                    - Separate file transfer JS and UI JS
                    - Remove JQuery and Bootstrap. very bloat, not wow.
*/


// General Purpose Code
/*
    $fileLeader and $fileClient -   Template for filelist items for
                                    Room Leader and Clients, respectively.
*/
var $uploadField, $fileList, $fileLeader, $fileClient, dropZone;
$(document).ready(function(){
    $uploadField = $(document.uploadForm.uploadField);
    $fileList = $('#fileList');
    $fileLeader = $('#templates .fileLeader');
    $fileClient = $('#templates .fileClient');
    dropZone = document.getElementById('uploadArea');
    dropZone.addEventListener('dragover', handleDragOver, false);
    dropZone.addEventListener('drop', handleFileSelect, false);
});


// Reference: http://www.html5rocks.com/en/tutorials/file/dndfiles/ for drag and drop
function handleFileSelect(evt) {
    evt.stopPropagation();
    evt.preventDefault();

    var files = evt.dataTransfer.files; // FileList object.
    //console.log(evt.dataTransfer.files);
    addFiles(files);
}

function handleDragOver(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}


var socket = io.connect(window.location.hostname);
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
var is_firefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

var pc; // Used if the client isn't an initiator
var peers = {}; //  Used to store clients connecting to the initator
var isLeader;   // If the client is the initiator
var roomId;
var files = {}; // List of files. file name, size, id, and actual data
var fileIds = 0;    // Fileid count

//Need to thoroughly test delay and tries mechanism.
var delay = 5, originalDelay = delay, diffDelay=10;   // Minimum delay between two responses.
var minDelay = 5;
var maxDelay = 1000;
var tryLimit = 15;  // Max number of attempts before failing


// {fileId: ..., chunkId: ...}
var reqQueue = [];
// {fileId: ..., chunkId: ..., peerId}
var responseQueue = [];

//Delay Mechanism for increasing and decreasing delay
function incDelay(){
    console.log("Increasing Delay");
    delay = Math.min(delay+diffDelay, maxDelay);
}
function decDelay(){
    if(delay - diffDelay >= minDelay){
        delay -= diffDelay;
    }
}

function getSuitableSizeUnit(bytes){
    if(bytes<1000){
        return (+bytes.toFixed(1))+"B";
    }
    bytes /= 1000;
    if(bytes<1000){
        return (+bytes.toFixed(1))+"KB";
    }
    bytes /= 1000;
    if(bytes<1000){
        return (+bytes.toFixed(1))+"MB";
    }
    bytes /= 1000;
    if(bytes<1000){
        return (+bytes.toFixed(1))+"GB";
    }
    return "???B";
}

// Returns a function object to be invoked with arg
function getFunc(func, arg){
    return function(){
        func(arg);
    }
}

function noOfChunks(size, chunkSize){
    return Math.ceil(size/chunkSize);
}

function newPeer(sock){   // Arguments applicable only for the leader
    var pc = new RTCPeerConnection(pc_config, {optional: [{DtlsSrtpKeyAgreement:true}]});
    var pc_config = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};
    pc.isLeader = isLeader;
    pc.socket = sock;   // Session id with the socket.io instance of the other peer
    var mediaConstraints = {};
    pc.onicecandidate = function (evt) {
        console.log('ice');
        socket.emit('ice', { "candidate": evt.candidate, "roomId": roomId, "socket": pc.socket});
    };
    pc.answer = function (){
        pc.createAnswer(gotDescription, function (event){}, mediaConstraints);
    }
    pc.offer = function (){
        pc.createOffer(gotDescription, function (event){}, mediaConstraints);
    }

    function handleDisconnect(){    // Detects when a peer isn't reachable any longer
        if(pc.iceConnectionState == 'disconnected' || pc.iceConnectionState == 'closed'){
            if(isLeader){
                delete peers[pc.socket];
                console.log('A user has left');
            }else{
                console.log('Lost Connection to the leader');
                $('#alertDiv').removeClass()
                            .addClass('alert')
                            .addClass('alert-danger')
                            .text('Lost connection to Room Leader! Maybe the leader closed the tab or some network problem on either side.')
                            .show();
                $('.glyphicon:not(.glyphicon-floppy-save)').removeClass('active');
            }
        }
    }

    if(isLeader) {  // Create a channel if initiator
        pc.channel = pc.createDataChannel("sendDataChannel");
        setupChannel(pc.channel);
        pc.channel.onopen = function(){
            console.log('User Joined');
            pc.oniceconnectionstatechange = handleDisconnect;
            sendFileInfoToNewUser(pc);
        }
    } else{ // Else wait for a channel from the initiator
        pc.ondatachannel = function(event) {
            console.log('connected channel');
            $('#alertDiv').removeClass()
                        .addClass('alert')
                        .addClass('alert-info')
                        .html('Connected to room '+roomId+
                            '<br />Download <span class="glyphicon glyphicon-save active"></span> a file, then \
                            Save <span class="glyphicon glyphicon-floppy-save active"></span> it.')
                        .show();
            pc.channel = event.channel;
            setupChannel(pc.channel);
            pc.oniceconnectionstatechange = handleDisconnect;
        };
    }

    function setupChannel(channel){
        var x = 0;
        channel.onmessage = function(event){
            console.log(event.data);
            var endmarkerStr = '"endmarker":1}';
            var endmarker = event.data.indexOf(endmarkerStr);
            var data;
            if(endmarker != -1){    // If end marker detected
                var JSONData = event.data.substr(0, endmarkerStr.length+endmarker);
                try{    // Try to go with the meaning
                    data = JSON.parse(JSONData);
                    data.fileChunk = event.data.substr(JSONData.length);
                }catch(e){  // Else assume a normal JSON
                    data = JSON.parse(event.data);
                }
            } else  // Normal JSON
                data = JSON.parse(event.data);

            if(isLeader){
                if(data.type == 'reqChunk')
                    handleRequest(data, pc);
            }else{
                if(data.type == 'responseChunk')
                    handleResponse(data);
                else if(data.type == 'newFile')
                    addFile(data);
                else if(data.type == 'removeFile')
                    removeFile(data.fileId);
            }
        };
    }
    function gotDescription (desc){
        pc.setLocalDescription(desc);
        socket.emit('sdp', { "sdp": desc , "roomId": roomId, "socket": pc.socket});
    }
    pc.chunkSize = getChunkSize();
    function getChunkSize(){
        return 5000;
    }
    return pc;
}

// When the leader receives a request, add it to the response queue
function handleRequest(request, pc){
    file = files[request.fileId];
    if(!file || 
        file.totChunk <= request.chunkId ||
        request.chunkId < 0
        )
        return false;
    responseQueue.push({fileId: request.fileId, chunkId: request.chunkId, peerId: pc.socket});

    // Start processing the response queue if it was already empty
    if(responseQueue.length == 1)
        processResponseQueue();
}
function handleResponse(response){
    if(reqQueue.length == 0 || reqQueue[0].chunkId != response.chunkId || reqQueue[0].fileId != response.fileId)
        return false;
    var file = files[response.fileId];
    file.arraybuf[response.chunkId] = new ArrayBuffer(response.fileChunk.length);
    var bufView = new Uint8Array(file.arraybuf[response.chunkId]);
    for(var i = 0;i<response.fileChunk.length;i++)
        bufView[i] = response.fileChunk.charCodeAt(i);
    reqQueue.shift();
    file.completed++;
    processReqQueue();
}
function processReqQueue(tries){
    if(typeof(tries)==='undefined')
        tries = tryLimit;
    if(reqQueue.length == 0)
        return true;
    if(!tries){
        console.log('Stalling Download, failed');
        return false;
    }
    var req = reqQueue[0];
    try{
        var data = {type: 'reqChunk', fileId: req.fileId, chunkId: req.chunkId};
        pc.channel.send(JSON.stringify(data));
        decDelay();
    }catch(e){
        console.log(e);
        console.log('Failed sending, queued for resending');
        incDelay();
        setTimeout(getFunc(processReqQueue, tries-1), delay);
    }
}
function processResponseQueue(tries){
    if(typeof(tries)==='undefined')
        tries = tryLimit;

    // If the request is invalid due the peer no longer existing, remove it
    while(responseQueue.length > 0 && !peers[responseQueue[0].peerId])
        responseQueue.shift();
    if(responseQueue.length != 0){
        if(!tries){
            console.log('Discarding Chunk: ', responseQueue[0]);
            responseQueue.shift();
        }else{
            try{
                var res = responseQueue[0];
                var pc = peers[res.peerId];
                var chunkSize = pc.chunkSize;
                var chunkId = res.chunkId;
                var fileChunk = files[res.fileId].arraybuf.slice(chunkId*chunkSize, (chunkId+1)*chunkSize);
                var fileChunkStr = String.fromCharCode.apply(null, new Uint8Array(fileChunk));

                var data = {type: 'responseChunk', fileId: res.fileId, chunkId: chunkId, endmarker:1};
                pc.channel.send(JSON.stringify(data)+fileChunkStr);
                responseQueue.shift();
                decDelay();
            }catch(e){
                incDelay();
                throw e;
                console.log(e);
                console.log('Failed sending, queued for resending');
                setTimeout(getFunc(processResponseQueue, tries-1), delay);
                return false;
            }
        }
    }
    
    // If response Queue is filled, schedule next response processing
    if(responseQueue.length > 0)
        setTimeout(getFunc(processResponseQueue, tryLimit), delay);
}
function updateProgress($target){
    var intervalId;
    var fileId = $target.data('fileId');
    var file = files[fileId];
    var $progressBar = $target.find('.progress-bar');
    var $progressText = $target.find('.progressText');
    var startTime = new Date().getTime();
    function update(){
        var progress = +(file.completed/file.totChunk*100).toFixed(1);
        $progressBar.css('width', progress+'%');
        $progressBar.attr('aria-valuenow', progress);
        $progressText.text(progress+"%");

        if(file.completed == file.totChunk){
            clearInterval(intervalId);

            // Will give really low value for small files due to the 500 ms offset at which it runs
            // need to shift it to other function
            var timeElapsed = (new Date().getTime() - startTime)/1000;
            var bytesPerSec = file.file.size/timeElapsed;
            $progressText.text('Completed in ' + (+timeElapsed.toFixed(1)) + 's ('+getSuitableSizeUnit(bytesPerSec)+'ps)');

            $saveLink = $target.find('.glyphicon-floppy-save');
            enableAction($saveLink);
            disableAction($target.find('.glyphicon-stop'))
            $saveLink = $saveLink.parent();
            var b = new Blob(file.arraybuf);
            var url = URL.createObjectURL(b);
            $saveLink.attr('href', url);
            $saveLink.attr('download', file.file.name);

        }
    }
    intervalId = setInterval(update, 500);
}
function startDownload(evt){
    $target = $(evt.target).closest('.row');
    fileId = $target.data('fileId');
    var file = files[fileId];
    var chunks = file.totChunk;
    for(var i = 0;i<chunks;i++)
        reqQueue.push({fileId: fileId, chunkId: i});

    updateProgress($target);
    processReqQueue(tryLimit);
}

function sendHighPriorityMsg(data, pc){
    var dataStr = JSON.stringify(data);
    if(!pc){
        for(id in peers){
            peers[id].channel.send(dataStr);
        }
    }else
        pc.channel.send(dataStr);
}
function sendFileInfoToNewUser(pc){
    for(id in files){
        f = files[id].file;
        sendHighPriorityMsg({type: 'newFile', fileId: id, name: f.name, size: f.size}, pc);
    }
}
function disableAction($target){
    $target.removeClass('active');
    $target.parent().off('click');
    $target.parent().attr('href', null);
}
function enableAction($target, func){
    $target.addClass('active');
    $target.parent().on('click', func);
    $target.parent().attr('href', '');
}
function addFile(data){
    $newFileDiv = $fileClient.clone();
    $newFileDiv.data('fileId', data.fileId);
    $newFileDiv.children('.fileName').text(data.name);
    $newFileDiv.children('.fileSize').text(getSuitableSizeUnit(data.size));
    $newFileDiv.attr('id', 'file'+data.fileId);

    // Enable Download Button
    $downBut = $newFileDiv.find('.glyphicon-save');
    enableAction($downBut, function (evt){
        evt.stopPropagation();
        evt.preventDefault();

        $target = $(evt.target).parent().parent();
        disableAction($target.find('.glyphicon-save'));
        enableAction($target.find('.glyphicon-stop'), function(){
            return false;
        });

        startDownload(evt);
        return false;
    });

    $fileList.append($newFileDiv);
    delete data['type'];
    files[data.fileId] = {file: data, 
        arraybuf: new Array(noOfChunks(data.size, pc.chunkSize)), 
        totChunk: noOfChunks(data.size, pc.chunkSize),
        completed: 0
    };
}
function getIdFromDOMObj(obj){
    return $(obj).closest('.row').data('fileId');
}
function removeFile(fileId){
    $('#file'+fileId).remove();
    delete files[fileId];
    if(isLeader){
        sendHighPriorityMsg({type: 'removeFile', fileId: fileId});
    }
    return false;
}


// Add files for upload to list
function addFiles(fs){
    for(var i = 0; i < fs.length; i++){
        var f = fs[i];
        var reader = new FileReader();
        reader.onload = (function(f){
            return function(e){
                files[fileIds] = {file: f, arraybuf: e.target.result};

                $newFileDiv = $fileLeader.clone();
                $newFileDiv.data('fileId', fileIds);
                $newFileDiv.attr('id', 'file'+fileIds);
                $newFileDiv.children('.fileName').text(f.name);
                $newFileDiv.children('.fileSize').text(getSuitableSizeUnit(f.size));
                /*enableAction($newFileDiv.find('.glyphicon-remove'), function(evt){
                    return removeFile(getIdFromDOMObj(evt.target));
                });*/

                $fileList.append($newFileDiv);

                sendHighPriorityMsg({type: 'newFile', fileId: fileIds, name: f.name, size: f.size});
                fileIds++;
            }
        })(f);
        reader.readAsArrayBuffer(f);
    }
}
function createRoom(){
    // Request room creation
    socket.emit('createRoom', {});
    $('#alertDiv').removeClass()
                .addClass('alert')
                .addClass('alert-info')
                .html('Requesting New Room...')
                .show();
    // When Room assigned
    socket.on('roomAssigned', function(data){
        roomId = data.roomId;
        $uploadField.on('change', function(){
            var fs = $uploadField[0].files;
            addFiles(fs);
        });
        window.location.hash = roomId;
        $('#alertDiv').removeClass()
                    .addClass('alert')
                    .addClass('alert-info')
                    .html('Users may join your room and download the shared files by visiting <br /> \
                        '+window.location)
                    .show();
        processResponseQueue(tryLimit);
    });
}
function joinRoom(){
    roomId = window.location.hash.substring(1);
    socket.emit('joinRoom', {"roomId": roomId});
    isLeader = false;
    pc = newPeer();
    $('#alertDiv').removeClass()
                .addClass('alert')
                .addClass('alert-info')
                .html('Requesting Connection to room ' + roomId
                    +'<br />If stuck too long, most probably the wrong room id or signal server problems.')
                .show();
}
function setup(){
    if(window.location.hash == ""){
        isLeader = true;
        createRoom();
    }else {
        $("#uploadArea").hide();
        joinRoom();
    }
}


// Signalling methods
socket.on('ice', function(signal) {
    $('#alertDiv').removeClass()
                .addClass('alert')
                .addClass('alert-info')
                .html('Establishing Connection to Room Leader...<br />\
                    May get stuck on this if the browsers are not compatible, see FAQ for more details.')
                .show();
    if(isLeader && (!signal.socket || !peers[signal.socket]))
        return;
    if(!isLeader && !pc)
        pc = newPeer();
    if(signal.candidate == null) {return;}

    if(isLeader)
        peers[signal.socket].addIceCandidate(new RTCIceCandidate(signal.candidate));
    else
        pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
});
socket.on('sdp', function(signal) {
    if(isLeader && (!signal.socket || !peers[signal.socket]))
        return;
    if(!isLeader && !pc)
        pc = newPeer();

    if(!isLeader)
        pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    else
        peers[signal.socket].setRemoteDescription(new RTCSessionDescription(signal.sdp));
    if(!isLeader)
        pc.answer();
});
socket.on('newSlave', function(data) {
    console.log('new slave');
    peers[data.socket] = newPeer(data.socket, data.nick);
    peers[data.socket].offer();
});
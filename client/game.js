const STATUS = {
  INIT: 0,
  WAIT: 1,
  START: 2,
}

// 游戏宽高
const WIDTH = 320;
const HEIGHT = 400;
const BOX_SIZE = 20;

const CMD = {
  STOP: 0,
  UP: 1,
  DOWN: 2,
  LEFT: 3,
  RIGHT: 4,
}

const CMD2DRIECT = {
  0: "STOP",
  1: "UP",
  2: "DOWN",
  3: "LEFT",
  4: "RIGHT",
}

const DIRECT2VEC = {
  UP: [0, -1],
  DOWN: [0, 1],
  LEFT: [-1, 0],
  RIGHT: [1, 0],
  STOP: [0, 0],
}

const KEY2DIRECT = {
  37: "LEFT",
  38: "UP",
  39: "RIGHT",
  40: "DOWN",
  13: "STOP",
}

function lerp(min, max, value) {
  return (max - min) * value + min;
}

///////////////////////////////
class Network {
  constructor() {
    this.socket = null;
    this.isConnected = false;

    // frame 数组   [{frame: number, ctrls: {id: []} }, ...]
    this.frameData = new Array();
    // 当前frame发送的命令
    this.curFrameCtrl = new Array();
    // sever frame ID
    this.serverFrameId = 0;
    // client frame ID
    this.clientFrameId = 0;
    // cmd handlers
    this.handlers = {}; 

    this.avgDelay = 0;
    this.avgDelaySum = 0;
    this.avgDelayCount = 0;
    this.avgDelayMax = 20;
  }

  start() {
    // 连接socket
    this.socket = io.connect('http://127.0.0.1:3000');
    this.socket.on("open", (data) => {
      this.isConnected = true;
      console.log(`socket连接成功: ${data.id}`)
    });
    // 断线
    this.socket.on('disconnect', function () {
      this.isConnected = false;
      console.log("与服务器断开连接!")
    });


    /**
     * recv frame data array
     * message:
     *  [
     *    {
     *      frame: number     服务端当前帧号
     *      ctrls: {id: []}   每个客户端的控制信息
     *    }
     *  ]
     */
    this.socket.on("message", (data) => {
      // 储存收到的指令 TODO:
      for (let i = 0; i < data.length; ++i) {
        this.frameData.push(data[i]);
      }

      // 更新最新的服务端 frameId
      this.serverFrameId = data[data.length - 1].frame;
    });

    this.socket.on("timeSync", (data) => {
      let client = data.client;
      let server = data.server;
      // 网络延迟
      let delay = Date.now() - client;
      this.avgDelaySum += delay;
      this.avgDelayCount += 1
      if (this.avgDelayCount == this.avgDelayMax) {
        this.avgDelay = Math.ceil(this.avgDelaySum / this.avgDelayCount);
        this.avgDelayCount = 0;
        this.avgDelaySum = 0;
      }
    });
  }

  onCtrlHandler(cmd, handler) {
    this.socket.on(cmd, handler);
  }

  sendCtrl(cmd, data) {
    this.socket.emit(cmd, data);
  }

  sendMsg(data) {
    if (!this.socket || !this.isConnected) {
      console.error("socket is not connnected");
      return;
    }
    this.curFrameCtrl.push(data);
  }

  sendMessage() {
    if (this.curFrameCtrl.length != 0) {
      // {frame: number, ctrl: [] }
      let data = {frame: this.clientFrameId, ctrl: this.curFrameCtrl};
      this.socket.emit("message", data);
      this.curFrameCtrl = new Array();
    }
  }
}

///////////////
class GameObject {
  constructor(id) {
    this.id = id;
    this.x = 0;
    this.y = 0;
    this.xF = 0;
    this.yF = 0;
    this.speed = 100;
    this.direct = "STOP";
  }

  updateFrame(dt) {
    dt = dt / 1000;
    let vec = DIRECT2VEC[this.direct];
    let x = this.xF;
    let y = this.yF;
    x += vec[0] * dt * this.speed;
    y += vec[1] * dt * this.speed;
    if (x <= (WIDTH - BOX_SIZE) && x >= 0) {
      this.xF = x
    }
    if (y <= (HEIGHT - BOX_SIZE) && y >= 0) {
      this.yF = y
    }
  }

  // 表现层Update要在逻辑层Update前? 表现层update 做平滑处理lerp?
  update(dt) {
    this.x = lerp(this.x, this.xF, dt/1000 * this.speed);
    this.y = lerp(this.y, this.yF, dt/1000 * this.speed);
  }


  onFrameData(ctrlArray) {
    for (let ctrl of ctrlArray) {
      let cmd = ctrl.cmd;
      let direct = CMD2DRIECT[cmd] || "STOP"
      this.direct = direct;
    }
  }
}

///////////////////////////////

class Game {
  constructor() {
    this.logicFps = 10;                     // 客户端固定逻辑帧
    this.frameDt = 1000 / this.logicFps;    // 逻辑帧处理固定dt
    this.readFps = 10;                      // 处理逻辑帧频率, 调整播放频率
    this.readTimeDt = 1.0 / this.readFps;
    this.readTime = 0;
    this.sendTime = 0;
    this.drawFps = 60;                      // 绘制帧数
    this.drawDt = 1000 / this.drawFps;
    this.drawTime = 0;
    this.lastDrawTime = 0;

    // 计算fps
    this.avgfps = 0;
    this.avgfpsSum = 0;
    this.avgfpsCount = 0;
    this.avgfpsMax = 20;

    this.gameStatus = STATUS.INIT,
    this.network = new Network();
    // 当前对象
    this.curObject = null;
    // 所有对象
    this.objects = {};

    this.context = null;
  }

  tick(dt) {
    if (this.gameStatus != STATUS.START) {
      return;
    }
    this.readTime -= dt;
    if (this.readTime <= 0) {
      this.readTime = this.readTime + this.readTimeDt;
      this.readFrame();
    }

    this.sendTime += dt;
    if (this.sendTime >= this.frameDt) {
      this.sendTime -= this.frameDt;
    }

    this.drawTime += dt;
    if (this.drawTime >= this.drawDt) {
      this.drawTime -= this.drawDt;
      this.drawUpdate(dt);
    }

    if (this.network.isConnected) {
      let now = Date.now();
      this.network.sendCtrl("timeSync", now);
    }
  }
  
  // 改变处理逻辑帧速率，加速减速
  changeReadFps(fps) {
    // 限制在 10-120
    this.readFps = Math.min(120, Math.max(10, fps));      
    this.readTimeDt = 1.0 / this.readFps;
    this.readTime = 0;
  }

  // 读取一帧逻辑帧的数据处理
  readFrame() {
    if (this.gameOver) {
      return;
    }

    // [{frame: number, ctrls: {id: []} }, ...]
    let frameData = this.network.frameData;
    if (frameData.length <= 0) {
      return;
    }

    let curFrame = frameData.shift();
    let ctrls = curFrame.ctrls;
    for (const id in ctrls) {
      let ctrl = ctrls[id];
      let obj = this.objects[id];
      if (obj) {
        // obj 执行对应的cmd
        obj.onFrameData(ctrl);
      }
    }

    this.updateFrame(this.frameDt)
  }

  // 逻辑帧Update
  updateFrame(dt) {
    this.network.clientFrameId += 1;
    // console.log(`serverFrameId ${this.network.serverFrameId}, clientFrameId ${this.network.clientFrameId}`);
    // if (this.network.clientFrameId > this.network.serverFrameId) {
    // }
    this.network.sendMessage();
    let objIds = Object.keys(this.objects).sort();
    for (const id of objIds) {
      const obj = this.objects[id];
      obj.updateFrame(dt);
    }
  }

  drawUpdate(dt) {
    let currentTime = Date.now();
    let elapsedTime = currentTime - this.lastDrawTime;
    let fps = Math.round(1000 / elapsedTime);
    this.lastDrawTime = currentTime;
    this.avgfpsSum += fps;
    this.avgfpsCount += 1;
    if (this.avgfpsCount >= this.avgfpsMax) {
      this.avgfps = Math.ceil(this.avgfpsSum / this.avgfpsCount);
      this.avgfpsSum = 0;
      this.avgfpsCount = 0;
    }
    // 绘制
    this.context.clearRect(0, 0, WIDTH, HEIGHT);
    $("#lag").text("延迟: " + this.network.avgDelay + "ms");
    $("#frame").text("fps: " + this.avgfps);

    for (const key in this.objects) {
      const obj = this.objects[key];
      obj.update(dt);
      
      requestAnimationFrame(() => {
        this.context.fillRect(obj.x, obj.y, BOX_SIZE, BOX_SIZE)
        this.context.font = "18px Arial";
        this.context.fillStyle = "#FFFFFF";
        this.context.fillText(key, obj.x, obj.y + BOX_SIZE, BOX_SIZE);
      });
    }
  }

  sendCtrl(cmd, data) {
    this.network.sendCtrl(cmd, data);
  }

  addObject(id, object) {
    this.objects[id] = object;
  }

  onKeyDown(keyCode) {
    switch(keyCode) {
      case 37:
      case 38:
      case 39:
      case 40:
      case 13:
      {
        let clientFrameId = this.network.clientFrameId;
        let serverFrameId = this.network.serverFrameId;
        if (clientFrameId < serverFrameId) {
          console.warn("当前帧小于服务端逻辑帧, 禁止操作");
          return;
        }
        const direction = KEY2DIRECT[keyCode];
        const cmd = CMD[direction];
        let msg = {cmd: cmd};
        this.network.sendMsg(msg);
        break;
      }  
    }
  }

  // 弹一个Tips
  showTips(str) {
    var width = str.length * 20 + 50
    var halfScreenWidth = $(window).width() / 2
    var halfScreenHeight = $(window).height() / 2
    $("#tips").stop()
    $("#tips").show()
    $("#tips").text(str)
    $("#tips").css("width", width)
    $("#tips").css("top", halfScreenHeight)
    $("#tips").css("left", halfScreenWidth - width / 2)
    $("#tips").animate({ top: halfScreenHeight - 100 })
    $("#tips").fadeOut()
    console.log(str)
  }

  start() {
    this.context = document.getElementById("canvas").getContext("2d");
    $("#content").hide();
    $("#login").show();
    $("#tips").hide();    

    // 按键监听
    $("body").keydown((e) => {
      switch(e.keyCode) {
        case 37: case 38: case 39: case 40:
        {
          this.showTips(KEY2DIRECT[e.keyCode]);
          break;
        }
      }
      this.onKeyDown(e.keyCode);
    });

    this.changeReadFps(this.logicFps);

    let network = this.network;
    network.start();
    network.onCtrlHandler("join", (json) => {
      this.showTips(json.message);
      if (json.result) {
        $("#login").hide();
        $("#content").show();
      }
    });
    network.onCtrlHandler("system", (msg) => {
      this.showTips(msg);
    });
    network.onCtrlHandler("start", (json) => {
      // 初始化GameObject
      for (let i = 0; i < json.player.length; ++i) {
        const id = json.player[i];
        let obj = new GameObject(id);
        this.addObject(id, obj);
      }
      this.gameStatus = STATUS.START;
      this.showTips("游戏开始");
    });

    $("#start_btn").click(() => {
      let account = $("#account").val();
      if (account == "") {
        showTips("请输入玩家id");
        return;
      }
      if (this.isConnected == false) {
        showTips("连接服务器失败!");
        return;
      }
      this.curObject = new GameObject(account);
      this.sendCtrl("join", account);
    })
  }
}


///////////////////////////////
$(function() {

  game = new Game();
  game.start();
  
  function tick(dt) {
    game.tick(dt);
  }

  let lastUpdate = Date.now();
  setInterval(function() {
    let now = Date.now();
    let dt = now - lastUpdate;
    lastUpdate = now;
    tick(dt);
  });

});

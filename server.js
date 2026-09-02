const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

function makeRoomCode() {
  let code;

  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));

  return code;
}

app.get("/", (req, res) => {
  res.send("WORLD WAR ONLINE SERVER IS RUNNING");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    game: "WORLD WAR",
    rooms: rooms.size
  });
});

io.on("connection", (socket) => {

  console.log("Player connected:", socket.id);

  socket.on("createRoom", ({ name, character }) => {

    const roomCode = makeRoomCode();

    const player = {
      id: socket.id,
      name: name || "Player 1",
      character: character || "KOHLI",
      hp: 100,
      score: 0,
      defending: false
    };

    rooms.set(roomCode, {
      players: [player],
      started: false,
      time: 60,
      timer: null
    });

    socket.join(roomCode);

    socket.data.roomCode = roomCode;

    socket.emit("roomCreated", {
      roomCode,
      players: [player]
    });

    console.log("Room created:", roomCode);
  });


  socket.on("joinRoom", ({ roomCode, name, character }) => {

    roomCode = String(roomCode || "").trim();

    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("errorMessage", "ROOM नहीं मिला");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("errorMessage", "ROOM पहले से पूरा है");
      return;
    }

    if (room.started) {
      socket.emit("errorMessage", "Battle पहले ही शुरू हो चुका है");
      return;
    }

    const player = {
      id: socket.id,
      name: name || "Player 2",
      character: character || "DHONI",
      hp: 100,
      score: 0,
      defending: false
    };

    room.players.push(player);

    socket.join(roomCode);

    socket.data.roomCode = roomCode;

    io.to(roomCode).emit("playersUpdate", {
      players: room.players
    });

    console.log("Player joined:", roomCode);
  });


  socket.on("startBattle", () => {

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room) return;

    if (room.players.length !== 2) {
      socket.emit("errorMessage", "2 players जरूरी हैं");
      return;
    }

    if (room.started) return;

    room.started = true;
    room.time = 60;

    io.to(roomCode).emit("battleStarted", {
      players: room.players,
      time: room.time
    });

    room.timer = setInterval(() => {

      room.time--;

      io.to(roomCode).emit("timerUpdate", room.time);

      if (room.time <= 0) {
        finishGame(roomCode);
      }

    }, 1000);
  });


  socket.on("attack", () => {

    playerAction(socket, "attack");
  });


  socket.on("quickAttack", () => {

    playerAction(socket, "quickAttack");
  });


  socket.on("defend", () => {

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);

    if (!room || !room.started) return;

    const player = room.players.find(p => p.id === socket.id);

    if (!player) return;

    player.defending = true;

    io.to(roomCode).emit("actionLog", {
      text: player.name + " ने DEFEND किया!"
    });
  });


  socket.on("disconnect", () => {

    console.log("Player disconnected:", socket.id);

    const roomCode = socket.data.roomCode;

    if (!roomCode) return;

    const room = rooms.get(roomCode);

    if (!room) return;

    room.players = room.players.filter(
      p => p.id !== socket.id
    );

    if (room.players.length === 0) {

      if (room.timer) {
        clearInterval(room.timer);
      }

      rooms.delete(roomCode);

    } else {

      io.to(roomCode).emit("playerLeft", {
        players: room.players
      });
    }
  });
});


function playerAction(socket, type) {

  const roomCode = socket.data.roomCode;
  const room = rooms.get(roomCode);

  if (!room || !room.started) return;

  const attacker = room.players.find(
    p => p.id === socket.id
  );

  const defender = room.players.find(
    p => p.id !== socket.id
  );

  if (!attacker || !defender) return;

  let damage = 0;

  if (type === "attack") {
    damage = Math.floor(Math.random() * 16) + 10;
  }

  if (type === "quickAttack") {
    damage = Math.floor(Math.random() * 9) + 5;
  }

  if (defender.defending) {
    damage = Math.floor(damage / 2);
    defender.defending = false;
  }

  defender.hp = Math.max(0, defender.hp - damage);

  attacker.score += damage;

  io.to(roomCode).emit("battleUpdate", {
    players: room.players,
    attacker: attacker.id,
    damage: damage,
    type: type
  });

  io.to(roomCode).emit("actionLog", {
    text:
      attacker.name +
      " ने " +
      type.toUpperCase() +
      " किया! Damage: " +
      damage
  });

  if (defender.hp <= 0) {
    finishGame(roomCode);
  }
}


function finishGame(roomCode) {

  const room = rooms.get(roomCode);

  if (!room || !room.started) return;

  room.started = false;

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  let winner = null;

  if (room.players.length === 2) {

    const p1 = room.players[0];
    const p2 = room.players[1];

    if (p1.hp > p2.hp) {
      winner = p1;
    } else if (p2.hp > p1.hp) {
      winner = p2;
    } else {
      winner = {
        id: null,
        name: "DRAW"
      };
    }
  }

  io.to(roomCode).emit("gameOver", {
    players: room.players,
    winner: winner
  });
}


const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("WORLD WAR server running on port " + PORT);
});

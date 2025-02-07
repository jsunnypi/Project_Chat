// 서버 구동 및 포트 초기화

const express = require("express");
const { WebSocketServer } = require("ws");
const wss = new WebSocketServer({ port: 8001 });
const app = express();
const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.listen(8000, () => {
  console.log("Server is running on http://localhost:8000");
});

app.post("/", (req, res) => {
  const user = req.body.user;
  res.cookie("user", user, { maxAge: 3600000, httpOnly: false }); // 쿠키에 user 저장 (1시간 유효)
  res.redirect("/chat");
});

app.get("*", (req, res) => {
  if (req.path !== "/chat") {
    res.redirect("/chat");
  } else {
    res.sendFile(__dirname + "/public/index.html");
  }
});
// 방과 사용자 정의
let rooms = { 로비: [] };
let clients = new Map();

// 유저가 접속하면 실행되는 코드
wss.on("connection", (ws) => {
  let currentUser = "";
  let currentRoom = "로비";

  joinRoom(ws, "로비"); //로비 접속
  ws.send(JSON.stringify({ type: "welcome", message: "환영합니다." })); // 환영 메시지

  // onMessage함수에 반응
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === "leaveRoom") {
        // 퇴장할 때
        console.log("leave");
        if (currentRoom !== "로비") {
          // 로비에서는 못 나감
          if (data.roomName) {
            broadcastToRoom(
              currentRoom,
              {
                type: "chat",
                message: `${currentUser}님이 방(${data.roomName})에서 나갔습니다.`,
                username: "안내",
              },
              ws // 자신에게는 퇴장 메시지 안나옴
            );
          }

          leaveRoom(ws, currentRoom);
          currentRoom = "로비";
          joinRoom(ws, "로비");
          ws.send(
            JSON.stringify({
              type: "chat",
              message: `로비로 이동했습니다.`,
              username: "안내",
            })
          );
        }
      } else if (data.type === "setUsername") {
        //유저 이름 설정 차후에는 수정 필요함
        currentUser = data.username;
        clients.set(ws, { username: currentUser, room: currentRoom });
        updateRoomUsers(currentRoom);
      } else if (data.type === "joinRoom") {
        console.log("join");
        if (currentRoom !== "로비") {
          // 로비가 아니면 방 입장 불가능
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                "현재 방을 나가기 전에는 다른 방으로 이동할 수 없습니다.",
            })
          );
          return;
        }
        leaveRoom(ws, currentRoom); // 퇴장
        joinRoom(ws, data.roomName); // 입장
        currentRoom = data.roomName;
        broadcastToRoom(currentRoom, {
          //입장 메시지
          type: "chat",
          message: `${currentUser}님이 방(${data.roomName})에 입장하셨습니다.`,
          username: "안내",
        });
      } else if (data.type === "createRoom") {
        console.log("create");
        //  방 생성은 로비에서만 가능
        if (currentRoom !== "로비") {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "로비에 있을 때만 방을 생성할 수 있습니다.",
            })
          );
          return;
        }
        const roomName = data.roomName;
        if (!rooms[roomName]) {
          // 방 생성 후 방에 자동으로 입장함
          rooms[roomName] = [];
          leaveRoom(ws, currentRoom);
          joinRoom(ws, roomName);
          currentRoom = roomName;
          ws.send(
            JSON.stringify({
              type: "chat",
              message: `방 "${roomName}"이(가) 생성되었습니다.`,
              username: "안내",
            })
          );
        } else {
          // 방 이름 중복 확인
          ws.send(
            JSON.stringify({
              type: "error",
              message: "이미 존재하는 방 이름입니다. 다른 이름을 사용하세요.",
            })
          );
        }
      } else if (data.type === "message") {
        // 기본 채팅 처리
        broadcastToRoom(currentRoom, {
          type: "chat",
          username: currentUser || "Anonymous",
          message: data.message,
        });
      }
    } catch (error) {
      // 에러처리
      console.error("Invalid message format:", message);
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid data format" })
      );
    }
  });

  ws.on("close", () => {
    // 연결 종료 처리
    leaveRoom(ws, currentRoom);
    clients.delete(ws);
  });
  // 방 입장 함수
  function joinRoom(client, roomName) {
    if (!rooms[roomName]) {
      rooms[roomName] = [];
    }
    rooms[roomName].push(client);
    clients.set(client, {
      username: clients.get(client)?.username || "Anonymous",
      room: roomName,
    });
    updateRoomUsers(roomName);
    broadcastRooms();
  }
  // 퇴장 함수
  function leaveRoom(client, roomName) {
    if (rooms[roomName]) {
      rooms[roomName] = rooms[roomName].filter((c) => c !== client);
      if (rooms[roomName].length === 0 && roomName !== "로비") {
        delete rooms[roomName]; // 방이 비어있으면 삭제 처리
      } else {
        broadcastToRoom(
          roomName,
          {
            type: "chat",
            message: `${
              clients.get(client)?.username || "Anonymous"
            }님이 방에서 나갔습니다.`,
            username: "안내",
          },
          client // 본인 제외
        );
      }
      updateRoomUsers(roomName);
      broadcastRooms();
    }
  }
  //  방 유저 갱신 함수
  function updateRoomUsers(roomName) {
    console.log(roomName, currentUser);
    if (rooms[roomName]) {
      const usersInRoom = rooms[roomName].map(
        (client) => clients.get(client)?.username || "Anonymous"
      );
      broadcastToRoom(roomName, {
        type: "usersInRoom",
        room: roomName,
        users: usersInRoom,
      });
    }
  }
  // 메시지 전송 함수 일부 제외 기능 추가
  function broadcastToRoom(roomName, message, excludeClient = null) {
    if (rooms[roomName]) {
      rooms[roomName].forEach((client) => {
        if (client !== excludeClient) {
          client.send(JSON.stringify(message));
        }
      });
    }
  }

  // 방 리스트 갱신 함수
  function broadcastRooms() {
    const roomList = Object.keys(rooms);
    wss.clients.forEach((client) => {
      client.send(JSON.stringify({ type: "roomList", rooms: roomList }));
    });
  }
});

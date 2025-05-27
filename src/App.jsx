import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

export default function App() {
  const [username, setUsername] = useState("");
  const [allUsers, setAllUsers] = useState({});
  const [joined, setJoined] = useState(false);
  const [peer, setPeer] = useState([]);

  const socketRef = useRef();
  const peerConnectionRef = useRef();
  const localStreamRef = useRef();
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const endCallBtnRef = useRef();

  useEffect(() => {
    socketRef.current = io("http://localhost:8080");

    socketRef.current.on("joined", (users) => {
      setAllUsers(users);
    });

    socketRef.current.on("offer", async ({ from, to, offer }) => {
      const pc = getPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit("answer", { from: to, to: from, answer });
      setPeer([from, to]);
    });

    socketRef.current.on("answer", async ({ from, to, answer }) => {
      const pc = getPeerConnection(to);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      setPeer([from, to]);
    });

    socketRef.current.on("icecandidate", async (candidate) => {
      if (candidate) {
        try {
          const pc = peerConnectionRef.current;
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("ICE candidate error:", err);
        }
      }
    });

    socketRef.current.on("call-ended", () => {
      endCall();
    });

    startLocalVideo();

    return () => {
      socketRef.current.disconnect();
      endCall();
    };
  }, []);

  const getPeerConnection = () => {
    if (!peerConnectionRef.current) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      peerConnectionRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socketRef.current.emit("icecandidate", {
            from: username,
            to: peer[0] === username ? peer[1] : peer[0],
            candidate: e.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }
    return peerConnectionRef.current;
  };

  const startLocalVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("getUserMedia error:", err);
    }
  };

  const joinUser = () => {
    if (!username.trim()) return;
    socketRef.current.emit("join-user", username);
    setJoined(true);
  };

  const startCall = async (user) => {
    const pc = getPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit("offer", {
      from: username,
      to: user,
      offer: pc.localDescription,
    });
    setPeer([username, user]);
  };

  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (endCallBtnRef.current) endCallBtnRef.current.style.display = "none";
  };

  const handleEndCall = () => {
    socketRef.current.emit("call-ended", peer);
    endCall();
  };

  return (
    <div className="p-6 bg-gray-900 text-white min-h-screen flex flex-col items-center">
      {!joined ? (
        <div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            className="p-2 mr-2 rounded text-black"
          />
          <button onClick={joinUser} className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700">
            Join
          </button>
        </div>
      ) : (
        <>
          <h2 className="my-2">Online Users</h2>
          <ul className="bg-gray-800 p-4 rounded mb-4 w-full max-w-md">
            {Object.keys(allUsers).map((user) =>
              user !== username ? (
                <li key={user} className="flex justify-between mb-2">
                  <span>{user}</span>
                  <button onClick={() => startCall(user)} className="bg-green-600 px-3 py-1 rounded">
                    📞 Call
                  </button>
                </li>
              ) : (
                <li key={user}>{user} (You)</li>
              )
            )}
          </ul>

          <div className="flex gap-4 w-full max-w-4xl">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-1/2 rounded bg-black" />
            <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 rounded bg-black" />
          </div>

          <button
            ref={endCallBtnRef}
            onClick={handleEndCall}
            className="mt-4 bg-red-600 px-4 py-2 rounded hover:bg-red-700"
            style={{ display: peer.length > 0 ? "block" : "none" }}
          >
            End Call
          </button>
        </>
      )}
    </div>
  );
}

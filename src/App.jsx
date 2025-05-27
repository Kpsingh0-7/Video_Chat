import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

export default function App() {
  const [username, setUsername] = useState("");
  const [allUsers, setAllUsers] = useState({});
  const [joined, setJoined] = useState(false);
  const [peer, setPeer] = useState([]);

  const socketRef = useRef();
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      await startLocalVideo();

      socketRef.current = io("http://localhost:8080");

      socketRef.current.on("joined", (users) => {
        setAllUsers(users);
      });

      socketRef.current.on("offer", async ({ from, to, offer }) => {
        if (peerConnectionRef.current) {
          socketRef.current.emit("call-busy", { to: from });
          return;
        }
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit("answer", { from: to, to: from, answer });
        setPeer([from, to]);
      });

      socketRef.current.on("answer", async ({ from, to, answer }) => {
        const pc = peerConnectionRef.current;
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          setPeer([from, to]);
        }
      });

      socketRef.current.on("icecandidate", async (candidate) => {
        if (candidate && peerConnectionRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error("ICE candidate error:", err);
          }
        }
      });

      socketRef.current.on("call-ended", () => {
        endCall();
      });

      socketRef.current.on("user-left", (user) => {
        if (peer.includes(user)) {
          endCall();
        }
      });

      socketRef.current.on("call-busy", () => {
        alert("User is busy in another call.");
      });
    };

    init();

    return () => {
      socketRef.current?.disconnect();
      endCall();
    };
  }, []);

  const startLocalVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing media devices:", err);
    }
  };

  const createPeerConnection = (targetUser) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peerConnectionRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit("icecandidate", {
          from: username,
          to: targetUser,
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

    return pc;
  };

  const joinUser = () => {
    if (!username.trim()) return;
    socketRef.current.emit("join-user", username);
    setJoined(true);
  };

  const startCall = async (user) => {
    if (peerConnectionRef.current) return;
    const pc = createPeerConnection(user);
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
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (localVideoRef.current && localStreamRef.current) {
      if (!localVideoRef.current.srcObject) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }

    setPeer([]);
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
                  <button
                    onClick={() => startCall(user)}
                    className="bg-green-600 px-3 py-1 rounded disabled:opacity-50"
                    disabled={peer.length > 0}
                  >
                    📞 Call
                  </button>
                </li>
              ) : (
                <li key={user}>{user} (You)</li>
              )
            )}
          </ul>

          <div className="flex gap-4 w-full max-w-4xl">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-1/2 rounded bg-black"
            />
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-1/2 rounded bg-black"
            />
          </div>

          {peer.length > 0 && (
            <button
              onClick={handleEndCall}
              className="mt-4 bg-red-600 px-4 py-2 rounded hover:bg-red-700"
            >
              End Call
            </button>
          )}
        </>
      )}
    </div>
  );
}

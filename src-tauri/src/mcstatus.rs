use serde::Serialize;
use tokio::io::{ AsyncReadExt, AsyncWriteExt };
use tokio::net::TcpStream;
use tokio::time::{ timeout, Duration };

#[derive(Serialize)]
pub struct ServerStatus {
    pub online: bool,
    pub players: PlayerCounts,
    pub motd: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct PlayerCounts {
    pub online: i64,
    pub max: i64,
}

fn write_varint(buf: &mut Vec<u8>, mut value: i32) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value = ((value as u32) >> 7) as i32;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn write_string(buf: &mut Vec<u8>, s: &str) {
    write_varint(buf, s.len() as i32);
    buf.extend_from_slice(s.as_bytes());
}

async fn read_varint(stream: &mut TcpStream) -> Result<i32, String> {
    let mut result: i32 = 0;
    let mut shift = 0;
    loop {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).await.map_err(|e| e.to_string())?;
        result |= ((byte[0] & 0x7f) as i32) << shift;
        if (byte[0] & 0x80) == 0 {
            break;
        }
        shift += 7;
        if shift > 35 {
            return Err("VarInt is too long".into());
        }
    }
    Ok(result)
}

/// Query a Minecraft server's status via the Server List Ping protocol
/// (handshake -> status request -> status response). This is the same
/// mechanism the vanilla client uses to show the server list preview.
#[tauri::command]
pub async fn get_server_status(
    protocol_version: i32,
    hostname: String,
    port: u16
) -> Result<ServerStatus, String> {
    let attempt = async {
        let mut stream = TcpStream::connect((hostname.as_str(), port)).await.map_err(|e|
            e.to_string()
        )?;

        // Handshake packet (id 0x00): protocol version, server address, port, next state (1 = status).
        let mut handshake_body = Vec::new();
        write_varint(&mut handshake_body, 0x00);
        write_varint(&mut handshake_body, protocol_version);
        write_string(&mut handshake_body, &hostname);
        handshake_body.extend_from_slice(&port.to_be_bytes());
        write_varint(&mut handshake_body, 1);

        let mut handshake_packet = Vec::new();
        write_varint(&mut handshake_packet, handshake_body.len() as i32);
        handshake_packet.extend_from_slice(&handshake_body);
        stream.write_all(&handshake_packet).await.map_err(|e| e.to_string())?;

        // Status request packet (id 0x00, empty body).
        let mut request_body = Vec::new();
        write_varint(&mut request_body, 0x00);
        let mut request_packet = Vec::new();
        write_varint(&mut request_packet, request_body.len() as i32);
        request_packet.extend_from_slice(&request_body);
        stream.write_all(&request_packet).await.map_err(|e| e.to_string())?;

        // Response: [packet length][packet id][json string length][json bytes].
        let _packet_len = read_varint(&mut stream).await?;
        let _packet_id = read_varint(&mut stream).await?;
        let json_len = read_varint(&mut stream).await? as usize;

        let mut json_buf = vec![0u8; json_len];
        stream.read_exact(&mut json_buf).await.map_err(|e| e.to_string())?;
        let json_str = String::from_utf8_lossy(&json_buf);

        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;

        let players_online = parsed["players"]["online"].as_i64().unwrap_or(0);
        let players_max = parsed["players"]["max"].as_i64().unwrap_or(0);
        let version = parsed["version"]["name"].as_str().map(|s| s.to_string());

        // description ("motd") may be a plain string or a chat component object.
        let motd = parsed["description"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| parsed["description"]["text"].as_str().map(|s| s.to_string()));

        Ok(ServerStatus {
            online: true,
            players: PlayerCounts { online: players_online, max: players_max },
            motd,
            version,
        })
    };

    match timeout(Duration::from_secs(5), attempt).await {
        Ok(result) => result,
        Err(_) => Err("Connection to server timed out".into()),
    }
}

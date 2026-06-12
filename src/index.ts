import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- PATHS ---
const DATA_DIR = path.join(process.cwd(), 'data');
const DEVICES_PATH = path.join(DATA_DIR, 'devices.json');
const CHANNELS_PATH = path.join(DATA_DIR, 'channels.json');

// --- INTERFACES ---
interface Device {
  id: string;
  name: string;
  ip: string;
  lastSeen: string;
  status: 'Online' | 'Offline';
}

interface Channel {
  id: string;
  name: string;
  category: string;
  logo: string;
  url: string;
}

// --- HELPER FUNCTIONS ---
const initStorage = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(CHANNELS_PATH)) fs.writeFileSync(CHANNELS_PATH, '[]');
  if (!fs.existsSync(DEVICES_PATH)) {
    // Generate dummy devices untuk testing UI
    const dummyDevices: Device[] = [
      { id: 'dev-1', name: 'STB Ruang Tamu', ip: '192.168.1.10', lastSeen: '2026-06-12 10:00', status: 'Online' },
      { id: 'dev-2', name: 'HP Android Yuka', ip: '192.168.1.15', lastSeen: '2026-06-11 20:00', status: 'Offline' }
    ];
    fs.writeFileSync(DEVICES_PATH, JSON.stringify(dummyDevices, null, 2));
  }
};

const getData = <T>(filePath: string): T[] => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const saveData = (filePath: string, data: any) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

initStorage();

// --- API ROUTES ---

// 1. Dashboard Stats
app.get('/api/stats', (req: Request, res: Response) => {
  const devices = getData<Device>(DEVICES_PATH);
  const channels = getData<Channel>(CHANNELS_PATH);
  res.json({
    totalDevices: devices.length,
    totalChannels: channels.length
  });
});

// 2. Devices Management
app.get('/api/devices', (req: Request, res: Response) => {
  res.json(getData<Device>(DEVICES_PATH));
});

app.delete('/api/devices/:id', (req: Request, res: Response) => {
  let devices = getData<Device>(DEVICES_PATH);
  devices = devices.filter(d => d.id !== req.params.id);
  saveData(DEVICES_PATH, devices);
  res.json({ message: 'Device berhasil dihapus' });
});

// 3. Channel Management (M3U Parser)
app.post('/api/channels/import', async (req: Request, res: Response) => {
  const { m3uUrl } = req.body;
  try {
    const response = await axios.get(m3uUrl);
    const lines = response.data.split('\n');

    const channels: Channel[] = [];
    let currentChannel: Partial<Channel> = {};

    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('#EXTINF:')) {
        const info = line.split(',');
        currentChannel.name = info[info.length - 1];

        const groupMatch = line.match(/group-title="([^"]+)"/);
        currentChannel.category = groupMatch ? groupMatch[1] : 'Uncategorized';

        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        currentChannel.logo = logoMatch ? logoMatch[1] : '';
      } else if (line.startsWith('http')) {
        currentChannel.url = line;
        currentChannel.id = 'ch-' + Date.now() + Math.floor(Math.random() * 1000);
        channels.push(currentChannel as Channel);
        currentChannel = {};
      }
    }

    saveData(CHANNELS_PATH, channels);
    res.json({ message: `Berhasil import ${channels.length} channel` });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil file M3U' });
  }
});

app.get('/api/channels', (req: Request, res: Response) => {
  res.json(getData<Channel>(CHANNELS_PATH));
});

// TAMBAHKAN ROUTE INI: Reset Playlist (Kosongkan file channels.json)
app.delete('/api/channels/reset', (req: Request, res: Response) => {
  try {
    saveData(CHANNELS_PATH, []); // Timpa dengan array kosong
    res.json({ message: 'Seluruh data playlist berhasil direset!' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mereset playlist' });
  }
});

// --- MIDDLEWARE AUTHENTICATION API V1 ---
const verifyApiKey = (req: Request, res: Response, next: express.NextFunction): void => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey === 'centauri') {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized: API Key tidak valid atau tidak ditemukan' });
  }
};

// --- PUBLIC API ENDPOINTS (v1) ---

// 1. Endpoint Join Server (Register Device)
app.post('/api/v1/join', verifyApiKey, (req: Request, res: Response) => {
  // Mendukung request via Body (JSON) maupun Query Param
  const deviceName = req.body.device_name || req.query.device_name;

  if (!deviceName) {
    return res.status(400).json({ error: 'Parameter device_name wajib disertakan' });
  }

  const devices = getData<Device>(DEVICES_PATH);

  // Format IP sederhana
  let ipAddr = req.ip || req.socket.remoteAddress || 'Unknown';
  if (ipAddr.includes('::ffff:')) ipAddr = ipAddr.replace('::ffff:', '');

  const newDevice: Device = {
    id: 'dev-' + Date.now().toString(36),
    name: deviceName as string,
    ip: ipAddr,
    lastSeen: new Date().toLocaleString('id-ID'),
    status: 'Online'
  };

  devices.push(newDevice);
  saveData(DEVICES_PATH, devices);

  res.json({
    message: 'Device berhasil bergabung',
    device: newDevice
  });
});

// 2. Endpoint Get Playlist
app.get('/api/v1/playlist', verifyApiKey, (req: Request, res: Response) => {
  const channels = getData<Channel>(CHANNELS_PATH);
  res.json({
    message: 'Success',
    total: channels.length,
    data: channels
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
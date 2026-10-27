const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const USERS_FILE = path.join(__dirname, 'users.json');

// --- 1. QEYDİYYAT (SIGN UP) ENDPOINT-İ ---
app.post('/api/signup', (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: "Zəhmət olmasa nömrə və şifrəni daxil edin." });
    }

    // Şifrə uzunluğu yoxlaması (ən azı 8 simvol)
    if (password.length < 8) {
        return res.status(400).json({ error: "Şifrə ən azı 8 simvoldan ibarət olmalıdır!" });
    }

    let users = [];
    if (fs.existsSync(USERS_FILE)) {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            users = JSON.parse(data);
        } catch (err) {
            users = [];
        }
    }

    const existingUser = users.find(u => u.phone === phone);
    if (existingUser) {
        return res.status(400).json({ error: "Bu nömrə artıq qeydiyyatdan keçib! Zəhmət olmasa daxil olun." });
    }

    users.push({ phone, password });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    res.json({ success: true, message: "Qeydiyyat uğurla tamamlandı!" });
});

// --- 2. GİRİŞ (LOGIN) ENDPOINT-İ ---
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: "Zəhmət olmasa nömrə və şifrəni daxil edin." });
    }

    let users = [];
    if (fs.existsSync(USERS_FILE)) {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            users = JSON.parse(data);
        } catch (err) {
            users = [];
        }
    }

    const user = users.find(u => u.phone === phone && u.password === password);
    if (!user) {
        return res.status(400).json({ error: "Daxil edilən nömrə və ya şifrə yanlışdır!" });
    }

    res.json({ success: true, message: "Giriş uğurludur!" });
});

// --- 3. PHOTON / NOMINATIM AXTARIŞ ENDPOINT-İ ---
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query || query.trim().length < 2) return res.json([]);

    try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=default`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'TaksiApp/1.0' } });

        if (response.data && response.data.features) {
            const results = response.data.features.map(f => {
                const props = f.properties;
                const nameParts = [props.name, props.street, props.housenumber, props.district, props.city || props.state, props.country]
                    .filter(Boolean);
                
                return {
                    name: nameParts.join(', '),
                    lat: f.geometry.coordinates[1],
                    lon: f.geometry.coordinates[0]
                };
            });
            
            if (results.length > 0) return res.json(results);
        }

        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=tr&limit=8`;
        const fbRes = await axios.get(fallbackUrl, { headers: { 'User-Agent': 'TaksiApp/1.0' } });
        
        if (fbRes.data && fbRes.data.length > 0) {
            const fbResults = fbRes.data.map(item => ({
                name: item.display_name,
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon)
            }));
            return res.json(fbResults);
        }

        res.json([]);
    } catch (error) {
        console.error("Axtarış Xətası:", error.message);
        res.json([]);
    }
});

// --- 4. OSRM REAL YOL MƏSAFƏSİ VƏ SÜRÜŞ MÜDDƏTİ ---
async function getRouteData(startCoord, endCoord) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${startCoord.lon},${startCoord.lat};${endCoord.lon},${endCoord.lat}?overview=false`;
        const response = await axios.get(url);
        if (response.data && response.data.routes && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            const distanceKm = (route.distance / 1000).toFixed(1);
            const tripDurationMinutes = Math.round(route.duration / 60);
            return { distanceKm, tripDurationMinutes };
        }
        return null;
    } catch (error) {
        console.error("Məsafə Xətası:", error.message);
        return null;
    }
}

// --- 5. RƏSMİ UKOME TARİFLƏRİNƏ ƏSASƏN QİYMƏT VƏ 2 AYRI VAXT ---
function calculateTaxiPrices(distanceKm, tripDurationMinutes) {
    const dist = parseFloat(distanceKm);
    const tripTime = parseInt(tripDurationMinutes) || Math.round((dist / 30) * 60);

    const baseOpening = 71.94;    // Açılış
    const perKmRate = 47.92;      // Km başı
    const minFare = 230.00;       // İndi-bindi limiti
    const trafficCost = Math.max(0, tripTime - Math.round(dist * 1.8)) * 3.5;

    // BiTaksi
    let bitaxiPrice = baseOpening + (dist * perKmRate) + trafficCost;
    if (bitaxiPrice < minFare) bitaxiPrice = minFare;
    const bitaxiPickupEta = Math.floor(Math.random() * 3) + 3;

    // Uber
    let uberPrice = (baseOpening + 3.0) + (dist * (perKmRate + 0.5)) + trafficCost;
    if (uberPrice < minFare) uberPrice = minFare;
    const uberPickupEta = Math.floor(Math.random() * 3) + 4;

    // Yandex Go
    let yandexPrice = (baseOpening - 2.0) + (dist * (perKmRate - 1.0)) + trafficCost;
    if (yandexPrice < minFare) yandexPrice = minFare;
    const yandexPickupEta = Math.floor(Math.random() * 2) + 2;

    return {
        yandex: {
            name: "Yandex Go",
            price: yandexPrice.toFixed(2),
            pickupEta: yandexPickupEta,
            tripDuration: tripTime
        },
        uber: {
            name: "Uber",
            price: uberPrice.toFixed(2),
            pickupEta: uberPickupEta,
            tripDuration: tripTime
        },
        birtaxi: {
            name: "BiTaksi",
            price: bitaxiPrice.toFixed(2),
            pickupEta: bitaxiPickupEta,
            tripDuration: tripTime
        }
    };
}

// --- 6. MÜQAYİSƏ ENDPOINT-İ ---
app.post('/api/compare', async (req, res) => {
    const { startCoord, endCoord, pickupName, dropoffName } = req.body;

    if (!startCoord || !endCoord) {
        return res.status(400).json({ error: "Zəhmət olmasa həm Haradan, həm də Haraya yerlərini seçin." });
    }

    const routeData = await getRouteData(startCoord, endCoord);

    if (!routeData) {
        return res.status(500).json({ error: "Məsafə və marşrutu hesablamaq mümkün olmadı." });
    }

    const services = calculateTaxiPrices(routeData.distanceKm, routeData.tripDurationMinutes);

    res.json({
        distanceKm: routeData.distanceKm,
        tripDurationMinutes: routeData.tripDurationMinutes,
        pickup: pickupName,
        dropoff: dropoffName,
        services
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server uğurla işləyir: http://localhost:${PORT}`);
});
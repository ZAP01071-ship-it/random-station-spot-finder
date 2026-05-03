const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const HEARTRAILS_URL = 'https://express.heartrails.com/api/json';
const HOTPEPPER_API_KEY = import.meta.env.VITE_HOTPEPPER_API_KEY;
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;

// UI Elements
const searchForm = document.getElementById('search-form');
const searchSection = document.getElementById('search-section');
const rouletteSection = document.getElementById('roulette-section');
const resultSection = document.getElementById('result-section');
const errorMsg = document.getElementById('error-message');
const resetBtn = document.getElementById('reset-btn');

const rouletteStrip = document.getElementById('roulette-strip');
const rouletteStatus = document.getElementById('roulette-status');

const stationNameResult = document.getElementById('station-name-result');
const stationLineResult = document.getElementById('station-line-result');
const stationDistanceResult = document.getElementById('station-distance-result');
const foodList = document.getElementById('food-list');
const playList = document.getElementById('play-list');

// ダミー画像リスト (カテゴリ別)
const DUMMY_IMAGES = {
  food: [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1498837167922-41c53b448ce7?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80'
  ],
  play: [
    'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1525684784712-4c2780e031ca?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1511886929837-354d827aae26?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1605806616949-1e87b487bc2a?auto=format&fit=crop&w=600&q=80'
  ]
};

function getRandomImage(category) {
  const images = DUMMY_IMAGES[category] || DUMMY_IMAGES.play;
  return images[Math.floor(Math.random() * images.length)];
}

// 2点間の距離(km)を計算 (Haversine公式)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球の半径(km)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// CORS proxy URL (AllOrigins)
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.classList.add('hidden');
}

// 1. Nominatim APIで場所の座標を取得
async function getCoordinates(locationName) {
  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(locationName)}&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'RandomStationSpotFinder/1.0' } });
  if (!res.ok) throw new Error('位置情報の取得に失敗しました。');
  const data = await res.json();
  if (data.length === 0) throw new Error('場所が見つかりませんでした。別のキーワードでお試しください。');
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name };
}

// 2. Overpass APIで周辺の駅を取得
async function getStationsAround(lat, lon, radiusKm = 30) {
  const radiusMeters = radiusKm * 1000;
  // railway=station のnodeを取得 (負荷軽減のため件数を最大200に制限)
  const query = `
    [out:json][timeout:30];
    node["railway"="station"](around:${radiusMeters},${lat},${lon});
    out 200;
  `;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: query
  });
  if (!res.ok) {
    if (res.status === 504) throw new Error('サーバーが混み合っています。距離を短くして再試行してください。');
    throw new Error(`APIエラー: ${res.status}`);
  }
  const data = await res.json();
  const stations = data.elements
    .filter(e => e.tags && e.tags.name)
    .map(e => ({
      id: e.id,
      name: e.tags.name,
      lat: e.lat,
      lon: e.lon
    }));
  
  if (stations.length === 0) throw new Error('30km圏内に駅が見つかりませんでした。');
  
  // 重複や近すぎる駅を間引くなどの処理は省略し、一意な名前でフィルタ
  const uniqueStations = [];
  const names = new Set();
  for (const st of stations) {
    if (!names.has(st.name)) {
      names.add(st.name);
      uniqueStations.push(st);
    }
  }
  return uniqueStations;
}

// 3. Hotpepper APIで駅周辺のグルメを取得
async function getHotpepperSpots(lat, lon, distanceKm) {
  let range = 3; // default 1000m
  if (distanceKm <= 0.3) range = 1;
  else if (distanceKm <= 0.5) range = 2;
  else if (distanceKm <= 1.0) range = 3;
  else if (distanceKm <= 2.0) range = 4;
  else range = 5;

  // GitHub Pagesなどの静的環境で動かすため、外部プロキシを使用
  const url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${HOTPEPPER_API_KEY}&lat=${lat}&lng=${lon}&range=${range}&lunch=1&count=12&format=json`;
  const proxiedUrl = CORS_PROXY + encodeURIComponent(url);
  
  try {
    const res = await fetch(proxiedUrl);
    if (!res.ok) throw new Error('CORS Proxy Error');
    const data = await res.json();
    
    if (data.results.error) {
      console.error('Hotpepper API Error:', data.results.error[0].message);
      return [];
    }

    if (!data.results.shop) return [];

    return data.results.shop.map(shop => ({
      id: shop.id,
      name: shop.name,
      image: shop.photo.pc.l,
      category: shop.genre.name,
      address: shop.address,
      access: shop.access,
      url: shop.urls ? shop.urls.pc : null,
      distance: null, // accessで代替
      isHotpepper: true
    }));
  } catch (error) {
    console.error('Failed to fetch Hotpepper data:', error);
    return [];
  }
}

// 4. Google Places API (New)で駅周辺の遊び場を取得
async function getGooglePlaySpots(lat, lon, distanceKm) {
  const radiusMeters = distanceKm * 1000;
  const url = 'https://places.googleapis.com/v1/places:searchNearby';
  
  const body = {
    includedTypes: ["amusement_park", "park", "tourist_attraction", "museum", "movie_theater", "spa", "bowling_alley", "aquarium", "zoo", "historical_landmark"],
    maxResultCount: 12,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius: radiusMeters
      }
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos,places.location,places.primaryType,places.websiteUri,places.googleMapsUri'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('Google Places API Error:', res.status);
      return [];
    }

    const data = await res.json();
    if (!data.places) return [];

    return data.places.map(place => {
      let imageUrl = null;
      if (place.photos && place.photos.length > 0) {
        const photoName = place.photos[0].name;
        imageUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=400&maxWidthPx=600&key=${GOOGLE_PLACES_API_KEY}`;
      }

      // 住所から「日本、〒XXX-XXXX」を取り除く
      let address = place.formattedAddress || '';
      address = address.replace(/^日本、(〒\d{3}-\d{4}\s*)?/, '');

      const lat2 = place.location ? place.location.latitude : lat;
      const lon2 = place.location ? place.location.longitude : lon;

      let category = 'お出かけ';
      if (place.primaryType === 'park') category = '公園';
      else if (place.primaryType === 'movie_theater') category = '映画館';
      else if (place.primaryType === 'museum') category = 'ミュージアム';
      else if (place.primaryType === 'amusement_park') category = '遊園地';
      else if (place.primaryType === 'spa') category = '温泉・スパ';

      return {
        id: place.id,
        name: place.displayName ? place.displayName.text : '不明なスポット',
        image: imageUrl,
        category: category,
        address: address,
        url: place.websiteUri || place.googleMapsUri,
        distance: calculateDistance(lat, lon, lat2, lon2),
        isGoogle: true
      };
    }).sort((a, b) => a.distance - b.distance);
  } catch (err) {
    console.error('Google Places fetch failed:', err);
    return [];
  }
}

// 5. HeartRails Expressで駅の路線名を取得
async function getStationDetails(lat, lon) {
  try {
    const url = `${HEARTRAILS_URL}?method=getStations&x=${lon}&y=${lat}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.response && data.response.station && data.response.station.length > 0) {
      return data.response.station[0];
    }
  } catch (e) {
    console.error('HeartRails API Error:', e);
  }
  return null;
}

// ルーレットアニメーション
function playRouletteAnimation(stations, targetStation) {
  return new Promise((resolve) => {
    rouletteStrip.innerHTML = '';
    rouletteStrip.style.transform = 'translateY(0)';
    rouletteStrip.style.transition = 'none';

    // ダミーの駅リストを20個ほど作成（最後にターゲット駅）
    const dummyCount = 20;
    const itemHeight = 80;
    
    for (let i = 0; i < dummyCount; i++) {
      const div = document.createElement('div');
      div.className = 'roulette-item';
      const randomSt = stations[Math.floor(Math.random() * stations.length)];
      div.textContent = randomSt.name + "駅";
      rouletteStrip.appendChild(div);
    }

    const targetDiv = document.createElement('div');
    targetDiv.className = 'roulette-item';
    targetDiv.textContent = targetStation.name + "駅";
    targetDiv.style.color = '#4ade80';
    rouletteStrip.appendChild(targetDiv);

    // 強制リフロー
    void rouletteStrip.offsetWidth;

    // アニメーション実行
    const targetY = -(dummyCount * itemHeight);
    rouletteStrip.style.transition = 'transform 4s cubic-bezier(0.15, 0.85, 0.2, 1)';
    rouletteStrip.style.transform = `translateY(${targetY}px)`;

    setTimeout(() => {
      resolve();
    }, 4500); // アニメーション完了を待つ
  });
}

function renderSpots(container, spots, category) {
  container.innerHTML = '';
  if (spots.length === 0) {
    container.innerHTML = '<div class="no-spots">指定された範囲内にスポットが見つかりませんでした😢</div>';
    return;
  }

  spots.forEach(spot => {
    const card = document.createElement('a');
    card.className = 'spot-card';
    if (spot.url) {
      card.href = spot.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
    }
    
    let badgeText = category === 'food' ? 'グルメ' : 'お出かけ';
    let imageSrc = getRandomImage(category);
    let addressHtml = '';
    let distanceHtml = '';

    if (spot.isHotpepper) {
      badgeText = spot.category;
      if (spot.image) imageSrc = spot.image;
      addressHtml = `
        <div class="spot-address">${spot.address}</div>
        <div class="spot-access">${spot.access}</div>
      `;
    } else if (spot.isGoogle) {
      badgeText = spot.category;
      if (spot.image) imageSrc = spot.image;
      addressHtml = `<div class="spot-address">${spot.address}</div>`;
      distanceHtml = `<div class="spot-distance">駅から ${spot.distance.toFixed(2)} km</div>`;
    } else {
      distanceHtml = `<div class="spot-distance">駅から ${spot.distance.toFixed(2)} km</div>`;
    }

    card.innerHTML = `
      <div class="spot-image">
        <img src="${imageSrc}" alt="${spot.name}" loading="lazy">
        <span class="spot-category-badge">${badgeText}</span>
      </div>
      <div class="spot-content">
        <h4 class="spot-name">${spot.name}</h4>
        ${addressHtml}
        ${distanceHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

// メインプロセス
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  
  const locationName = document.getElementById('location').value.trim();
  const distanceKm = parseFloat(document.getElementById('distance').value);

  if (!locationName || isNaN(distanceKm)) {
    showError('正しい値を入力してください。');
    return;
  }

  // UI切り替え
  searchSection.classList.add('hidden');
  rouletteSection.classList.remove('hidden');
  rouletteStatus.textContent = '出発地点の座標を取得中...';

  try {
    // 1. 座標取得
    const origin = await getCoordinates(locationName);
    
    rouletteStatus.textContent = `${distanceKm}km圏内の駅を検索中...`;
    
    // 2. 駅取得 (対象エリアの広さを適用)
    const stations = await getStationsAround(origin.lat, origin.lon, distanceKm);
    
    // ランダムに1つ選ぶ
    const targetStation = stations[Math.floor(Math.random() * stations.length)];
    const distFromOrigin = calculateDistance(origin.lat, origin.lon, targetStation.lat, targetStation.lon);

    rouletteStatus.textContent = '駅を抽選しています...';
    
    // ルーレット開始
    await playRouletteAnimation(stations, targetStation);

    rouletteStatus.textContent = '周辺のスポットを検索中...';
    const SPOT_SEARCH_RADIUS_KM = 3.0; // 候補を増やすため1.5kmから3.0kmに拡大

    // HeartRailsで駅の詳細を取得
    const stationDetailsPromise = getStationDetails(targetStation.lat, targetStation.lon);
    
    // スポット取得 (グルメはHotpepper, 遊び場はGoogle Places)
    const hotpepperPromise = getHotpepperSpots(targetStation.lat, targetStation.lon, SPOT_SEARCH_RADIUS_KM);
    const playSpotsPromise = getGooglePlaySpots(targetStation.lat, targetStation.lon, SPOT_SEARCH_RADIUS_KM);

    const [stationDetails, foodSpots, playSpots] = await Promise.all([
      stationDetailsPromise,
      hotpepperPromise,
      playSpotsPromise
    ]);

    // 結果表示
    rouletteSection.classList.add('hidden');
    resultSection.classList.remove('hidden');

    stationNameResult.textContent = targetStation.name;
    
    if (stationDetails && stationDetails.line) {
      stationLineResult.textContent = `${stationDetails.line} (${stationDetails.prefecture})`;
      stationLineResult.classList.remove('hidden');
    } else {
      stationLineResult.classList.add('hidden');
    }

    stationDistanceResult.textContent = `出発地（${locationName}周辺）から約 ${distFromOrigin.toFixed(1)} km`;

    renderSpots(foodList, foodSpots, 'food');
    renderSpots(playList, playSpots, 'play');

  } catch (err) {
    console.error(err);
    showError(err.message || 'エラーが発生しました。');
    rouletteSection.classList.add('hidden');
    searchSection.classList.remove('hidden');
  }
});

resetBtn.addEventListener('click', () => {
  resultSection.classList.add('hidden');
  searchSection.classList.remove('hidden');
  document.getElementById('location').value = '';
  document.getElementById('distance').value = '30';
});

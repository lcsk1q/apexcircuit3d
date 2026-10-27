// shared/carData.js
// Database com 16 carros com especificacoes unicas e modelos car1.glb a car10.glb
// (car11-car16 reaproveitam modelos 1-6 ate novos arquivos serem adicionados).

export const CARS_DATABASE = [
  // TIER 1 - Carros iniciais (Gratuitos)
  {
    id: 'car_01_civic',
    name: 'Honda Civic',
    tier: 1,
    price: 0,
    modelPath: '/models/car1.glb',
    modelScale: 1.0,
    topSpeed: 45,
    acceleration: 32,
    handling: 2.4,
    braking: 2.2,
    weight: 1.2,
    description: 'Carro urbano compacto e equilibrado. Perfeito para iniciantes.',
    color: '#3b82f6',
    brand: 'Honda',
    year: 2023
  },

  // TIER 2 - Carros intermediarios
  {
    id: 'car_02_mustang',
    name: 'Ford Mustang GT',
    tier: 2,
    price: 250,
    modelPath: '/models/car2.glb',
    modelScale: 1.0,
    topSpeed: 52,
    acceleration: 42,
    handling: 2.3,
    braking: 2.4,
    weight: 1.5,
    description: 'Muscle car classico com potencia bruta em retas.',
    color: '#ef4444',
    brand: 'Ford',
    year: 2022
  },

  {
    id: 'car_03_bmw',
    name: 'BMW M340i',
    tier: 2,
    price: 300,
    modelPath: '/models/car3.glb',
    modelScale: 1.0,
    topSpeed: 50,
    acceleration: 45,
    handling: 2.8,
    braking: 2.6,
    weight: 1.4,
    description: 'Sedan de luxo com excelente estabilidade em curvas.',
    color: '#3b82f6',
    brand: 'BMW',
    year: 2023
  },

  {
    id: 'car_04_nissan',
    name: 'Nissan GT-R',
    tier: 2,
    price: 350,
    modelPath: '/models/car4.glb',
    modelScale: 1.0,
    topSpeed: 55,
    acceleration: 50,
    handling: 3.0,
    braking: 2.8,
    weight: 1.3,
    description: 'Lendaria maquina japonesa com aceleracao devastadora.',
    color: '#10b981',
    brand: 'Nissan',
    year: 2023
  },

  // TIER 3 - Carros desportivos avancados
  {
    id: 'car_05_corvette',
    name: 'Chevrolet Corvette C8',
    tier: 3,
    price: 550,
    modelPath: '/models/car5.glb',
    modelScale: 1.0,
    topSpeed: 58,
    acceleration: 48,
    handling: 3.1,
    braking: 2.9,
    weight: 1.2,
    description: 'Super desportivo americano de motor central. Velocidade pura.',
    color: '#fbbf24',
    brand: 'Chevrolet',
    year: 2023
  },

  {
    id: 'car_06_lamborghini',
    name: 'Lamborghini Huracan',
    tier: 3,
    price: 650,
    modelPath: '/models/car6.glb',
    modelScale: 1.0,
    topSpeed: 62,
    acceleration: 52,
    handling: 3.2,
    braking: 3.0,
    weight: 1.1,
    description: 'Supercar italiano com design futurista e potencia brutal.',
    color: '#fbbf24',
    brand: 'Lamborghini',
    year: 2022
  },

  {
    id: 'car_07_ferrari',
    name: 'Ferrari F8 Tributo',
    tier: 3,
    price: 700,
    modelPath: '/models/car7.glb',
    modelScale: 1.0,
    topSpeed: 63,
    acceleration: 51,
    handling: 3.3,
    braking: 3.1,
    weight: 1.15,
    description: 'Icone de velocidade e precisao. O sonho de todo piloto.',
    color: '#dc2626',
    brand: 'Ferrari',
    year: 2023
  },

  {
    id: 'car_08_porsche',
    name: 'Porsche 911 Turbo',
    tier: 3,
    price: 680,
    modelPath: '/models/car8.glb',
    modelScale: 1.0,
    topSpeed: 60,
    acceleration: 50,
    handling: 3.4,
    braking: 3.2,
    weight: 1.25,
    description: 'Classico moderno com melhor manejo de todos os supercarros.',
    color: '#fbbf24',
    brand: 'Porsche',
    year: 2023
  },

  // TIER 4 - Carros lendarios e ultra-rapidos
  {
    id: 'car_09_bugatti',
    name: 'Bugatti Chiron',
    tier: 4,
    price: 1200,
    modelPath: '/models/car9.glb',
    modelScale: 1.0,
    topSpeed: 68,
    acceleration: 55,
    handling: 2.8,
    braking: 3.0,
    weight: 1.6,
    description: 'Hipercarro frances. Pura velocidade em forma de arte.',
    color: '#000000',
    brand: 'Bugatti',
    year: 2023
  },

  {
    id: 'car_10_pagani',
    name: 'Pagani Huayra',
    tier: 4,
    price: 1100,
    modelPath: '/models/car10.glb',
    modelScale: 1.0,
    topSpeed: 67,
    acceleration: 54,
    handling: 3.5,
    braking: 3.3,
    weight: 1.05,
    description: 'Obra de arte italiana com precisao de cirurgiao.',
    color: '#8b5a3c',
    brand: 'Pagani',
    year: 2022
  },

  {
    id: 'car_11_koenigsegg',
    name: 'Koenigsegg Jesko',
    tier: 4,
    price: 1300,
    modelPath: '/models/car1.glb',
    modelScale: 1.0,
    topSpeed: 70,
    acceleration: 57,
    handling: 3.4,
    braking: 3.4,
    weight: 1.0,
    description: 'Sueco leve e aerodinamico. O pico da engenharia automotiva.',
    color: '#00ff88',
    brand: 'Koenigsegg',
    year: 2023
  },

  {
    id: 'car_12_ssc',
    name: 'SSC Tuatara',
    tier: 4,
    price: 1400,
    modelPath: '/models/car2.glb',
    modelScale: 1.0,
    topSpeed: 72,
    acceleration: 58,
    handling: 3.2,
    braking: 3.3,
    weight: 1.0,
    description: 'Record mundial de velocidade. Velocidade nao tem limite.',
    color: '#6366f1',
    brand: 'SSC',
    year: 2023
  },

  // TIER 5 - Conceitos futuristas (Premium exclusivo)
  {
    id: 'car_13_tesla',
    name: 'Tesla Model S Plaid',
    tier: 5,
    price: 1800,
    modelPath: '/models/car3.glb',
    modelScale: 1.0,
    topSpeed: 65,
    acceleration: 60,
    handling: 3.6,
    braking: 3.5,
    weight: 0.95,
    description: 'Veiculo eletrico futurista com aceleracao do futuro.',
    color: '#06b6d4',
    brand: 'Tesla',
    year: 2023
  },

  {
    id: 'car_14_rimac',
    name: 'Rimac C_Two',
    tier: 5,
    price: 2000,
    modelPath: '/models/car4.glb',
    modelScale: 1.0,
    topSpeed: 71,
    acceleration: 62,
    handling: 3.7,
    braking: 3.6,
    weight: 0.9,
    description: 'Hipercarro croata eletrico. O futuro e AGORA.',
    color: '#a78bfa',
    brand: 'Rimac',
    year: 2023
  },

  {
    id: 'car_15_lotus',
    name: 'Lotus Evija',
    tier: 5,
    price: 1900,
    modelPath: '/models/car5.glb',
    modelScale: 1.0,
    topSpeed: 70,
    acceleration: 61,
    handling: 3.8,
    braking: 3.7,
    weight: 0.85,
    description: 'Lendaria Lotus reimaginada para o futuro eletrico.',
    color: '#f472b6',
    brand: 'Lotus',
    year: 2023
  },

  {
    id: 'car_16_concept',
    name: 'Concept Cyber X1',
    tier: 5,
    price: 2500,
    modelPath: '/models/car6.glb',
    modelScale: 1.0,
    topSpeed: 75,
    acceleration: 65,
    handling: 4.0,
    braking: 3.8,
    weight: 0.8,
    description: 'Conceito futurista puro. Velocidade transcendental.',
    color: '#ec4899',
    brand: 'Apex',
    year: 2099
  }
];

/**
 * Mapa de mapas disponíveis com configuracoes de iluminacao e ambiente
 */
export const MAPS_DATABASE = {
  city: {
    id: 'city',
    name: 'Metropole Urbana',
    skyColor: 0x87ceeb,
    groundColor: 0x666666,
    fogColor: 0x87ceeb,
    fogNear: 20,
    fogFar: 500,
    ambientLightIntensity: 0.7,
    directionalLightIntensity: 1.0,
    theme: 'URBAN',
    description: 'Circuito urbano com arranha-céus e ruas largas.'
  },
  desert: {
    id: 'desert',
    name: 'Canyon das Dunas',
    skyColor: 0xffa500,
    groundColor: 0xdaa520,
    fogColor: 0xffa500,
    fogNear: 50,
    fogFar: 800,
    ambientLightIntensity: 1.2,
    directionalLightIntensity: 1.3,
    theme: 'DESERT',
    description: 'Pista no deserto com grandes dunas e penhascos.'
  },
  night: {
    id: 'night',
    name: 'Pista Noturna Neon',
    skyColor: 0x0a0e27,
    groundColor: 0x1a1a3e,
    fogColor: 0x0a0e27,
    fogNear: 30,
    fogFar: 400,
    ambientLightIntensity: 0.3,
    directionalLightIntensity: 0.5,
    theme: 'CYBER',
    description: 'Circuito noturno com iluminacao neon futurista.'
  }
};

/**
 * Retorna um carro por ID
 */
export function getCarById(carId) {
  return CARS_DATABASE.find(car => car.id === carId);
}

/**
 * Retorna todos os carros de um tier específico
 */
export function getCarsByTier(tier) {
  return CARS_DATABASE.filter(car => car.tier === tier);
}

/**
 * Retorna um mapa por ID
 */
export function getMapById(mapId) {
  return MAPS_DATABASE[mapId];
}

/**
 * Ordena carros por preço
 */
export function getCarsSortedByPrice(ascending = true) {
  return [...CARS_DATABASE].sort((a, b) => 
    ascending ? a.price - b.price : b.price - a.price
  );
}

/**
 * Ordena carros por velocidade máxima
 */
export function getCarsSortedBySpeed(ascending = false) {
  return [...CARS_DATABASE].sort((a, b) => 
    ascending ? a.topSpeed - b.topSpeed : b.topSpeed - a.topSpeed
  );
}

export default CARS_DATABASE;

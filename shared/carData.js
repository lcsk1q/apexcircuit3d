// shared/carData.js
// Database com 10 carros (modelos car1.glb a car10.glb na pasta public/models/)
// Cada carro tem seu modelo exclusivo, escalado proporcionalmente pelo cliente.

export const CARS_DATABASE = [
  // TIER 1 - Carro inicial (Gratuito)
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

  // TIER 2 - Carros intermediários
  {
    id: 'car_02_mustang',
    name: 'Ford Mustang GT',
    tier: 2,
    price: 250,
    modelPath: '/models/car2.glb',
    modelScale: 1.0,
    modelRotationY: Math.PI, // modelo virado de costas
    topSpeed: 52,
    acceleration: 42,
    handling: 2.3,
    braking: 2.4,
    weight: 1.5,
    description: 'Muscle car clássico com potência bruta em retas.',
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
    description: 'Lendária máquina japonesa com aceleração devastadora.',
    color: '#10b981',
    brand: 'Nissan',
    year: 2023
  },

  // TIER 3 - Carros esportivos avançados
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
    description: 'Super esportivo americano de motor central. Velocidade pura.',
    color: '#fbbf24',
    brand: 'Chevrolet',
    year: 2023
  },

  {
    id: 'car_06_lamborghini',
    name: 'Lamborghini Huracán',
    tier: 3,
    price: 650,
    modelPath: '/models/car6.glb',
    modelScale: 1.0,
    modelRotationY: Math.PI, // modelo virado de costas
    topSpeed: 62,
    acceleration: 52,
    handling: 3.2,
    braking: 3.0,
    weight: 1.1,
    description: 'Supercarro italiano com design futurista e potência brutal.',
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
    description: 'Ícone de velocidade e precisão. O sonho de todo piloto.',
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
    description: 'Clássico moderno com melhor manejo de todos os supercarros.',
    color: '#fbbf24',
    brand: 'Porsche',
    year: 2023
  },

  // TIER 4 - Carros lendários e ultra-rápidos
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
    description: 'Hipercarro francês. Pura velocidade em forma de arte.',
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
    description: 'Obra de arte italiana com precisão de cirurgião.',
    color: '#8b5a3c',
    brand: 'Pagani',
    year: 2022
  }
];

/**
 * Mapa de mapas disponíveis com configurações de iluminação e ambiente
 */
export const MAPS_DATABASE = {
  city: {
    id: 'city',
    name: 'Metrópole Urbana',
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
    name: 'Cânion das Dunas',
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
    description: 'Circuito noturno com iluminação neon futurista.'
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

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const PROJECT_NAME_ADJECTIVES = [
  "Healthy", "Brave", "Calm", "Clever", "Cosmic", "Crimson", "Curious", "Daring",
  "Electric", "Emerald", "Fancy", "Fluffy", "Gentle", "Golden", "Hidden", "Jolly",
  "Lucky", "Mighty", "Mystic", "Noble", "Polite", "Quiet", "Rapid", "Ruby",
  "Sacred", "Silent", "Silver", "Sleepy", "Snug", "Solar", "Spicy", "Sturdy",
  "Sunny", "Swift", "Tidy", "Velvet", "Vivid", "Wandering", "Wild", "Witty",
  "Zesty", "Cozy",
];

const PROJECT_NAME_ANIMALS = [
  "Jaguar", "Otter", "Falcon", "Panda", "Lynx", "Marmot", "Heron", "Badger",
  "Cobra", "Dolphin", "Eagle", "Fox", "Gecko", "Hawk", "Ibis", "Koala",
  "Lemur", "Moose", "Newt", "Owl", "Puma", "Quokka", "Rabbit", "Seal",
  "Tiger", "Urchin", "Viper", "Walrus", "Yak", "Zebra", "Bison", "Camel",
  "Ferret", "Gibbon", "Hare", "Iguana", "Jackal", "Koi", "Llama", "Mantis",
];

/** Generates a random "Adjective Animal" name, e.g. "Healthy Jaguar". */
export function randomProjectName(): string {
  const adjective = PROJECT_NAME_ADJECTIVES[Math.floor(Math.random() * PROJECT_NAME_ADJECTIVES.length)];
  const animal = PROJECT_NAME_ANIMALS[Math.floor(Math.random() * PROJECT_NAME_ANIMALS.length)];
  return `${adjective} ${animal}`;
}

/** "product-detail" → "Product Detail", "home" → "Home", "Home" → "Home". */
export function formatScreenLabel(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

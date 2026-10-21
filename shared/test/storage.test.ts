import { MemoryStorage } from '../src/storage';
import { storageContract } from './storageContract';

storageContract('in memory', () => new MemoryStorage());

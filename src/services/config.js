export {
    default as default,
    ConfigRepository,
    transformKey
} from './database/configRepository.js';

import configRepository from './database/configRepository.js';
window.configRepository = configRepository;

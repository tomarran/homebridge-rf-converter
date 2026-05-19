export const PLATFORM_NAME = 'RFConverter';
export const PLUGIN_NAME = 'homebridge-rf-converter';

export const REQUEST_URL = 'http://47.254.152.213/yetcloud_release/';
export const UDP_PORT = 26258;

export const ANDROID_CLIENT = {
  security_code: 'SDLKELS384DJ29Z49021DX30D92KS58S',
  headers: {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Connection': 'keep-alive',
    'Accept-Encoding': 'gzip',
    'User-Agent': 'okhttp/3.12.0',
  },
};

export const IOS_CLIENT = {
  security_code: 'DSKWIJAKZXLQPSZMANXVTBFGYHPNVCRE',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Connection': 'keep-alive',
    'Accept': '*/*',
    'User-Agent': 'Safemate/2.2.1 (iPhone; iOS 17.1.2; Scale/3.00)',
    'Accept-Language': 'ko-KR;q=1, en-KR;q=0.9, ja-KR;q=0.8',
  },
};

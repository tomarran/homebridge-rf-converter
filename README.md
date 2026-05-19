# homebridge-rf-converter

A Homebridge plugin for the **RF Converter V3.0** (Safemate). Each RF remote button becomes a HomeKit Outlet — flip a HomeKit outlet on/off and the plugin transmits the corresponding RF signal via your local converter device.

This is a Node.js port of the Home Assistant integration at [3735943886/rf_converter](https://github.com/3735943886/rf_converter), wrapped in a Homebridge dynamic platform with a custom Homebridge UI X setup wizard.

## How it works

The Safemate app stores your remotes in the vendor's cloud. This plugin can:

1. Pull all remotes/keys associated with your Safemate account from the cloud.
2. (Or) accept manual remote definitions if you don't have a Safemate account.
3. Send commands by building the proprietary binary packet and UDP-broadcasting it to the converter device's local IP on port 26258.

Commands are one-way (RF transmit only), so HomeKit "outlet" state is tracked internally and assumed to match what was last sent.

## Install

```sh
npm install -g homebridge-rf-converter
```

Then open the plugin's settings inside **homebridge-config-ui-x** — you'll get a setup wizard.

## Setup wizard

1. **Step 1** — pick *Use Safemate account* or *Manual entry*.
2. **Step 2 (cloud)** — enter your Safemate account, hit *Fetch*. The plugin loads all your remotes and their keys.
3. **Step 2 (manual)** — fill in each remote's name, IP, MAC, type, project, ID, frequency, and the available keys.
4. **Step 3** — map outlets:
   - **Outlet name** — what appears in HomeKit.
   - **Remote** — which remote to use.
   - **ON key** — the key sent when HomeKit turns the outlet on.
   - **OFF key** — the key sent when HomeKit turns the outlet off (optional — leave blank to make it a momentary press).
   - **Stateful** — uncheck if both states are really just a single momentary button.
   - **Test ON / Test OFF** buttons send the key live so you can confirm wiring before saving.

Save, then restart Homebridge to register the accessories.

## Config (manual)

The plugin's config block in `config.json` looks like:

```json
{
  "platform": "RFConverter",
  "name": "RF Converter",
  "account": "you@example.com",
  "useAndroidClient": true,
  "remotes": [
    {
      "name": "Living Room",
      "ip": "192.168.1.42",
      "mac": "aabbccddeeff",
      "type": 1,
      "project": 1,
      "id": 12345,
      "frequency": 433,
      "keys": [
        { "name": "Power On",  "value": 1 },
        { "name": "Power Off", "value": 2 }
      ]
    }
  ],
  "outlets": [
    {
      "name": "Living Room Lamp",
      "remote": "Living Room",
      "onKey": "Power On",
      "offKey": "Power Off",
      "stateful": true
    }
  ]
}
```

## Limitations

- **One-way RF** — HomeKit state is local-only; if you press the physical remote, HomeKit won't know.
- **Cloud dependency for setup** — fetching remotes requires the Safemate cloud (`http://47.254.152.213/yetcloud_release/`). Once fetched, runtime is fully local (UDP to your converter's IP).
- **No retry/ack** — UDP packets are fire-and-forget. If a command doesn't land, HomeKit still believes it did.

## Development

```sh
npm install
npm run build
```

Symlink for live testing:

```sh
npm link
hb-service restart
```

## License

MIT — see [LICENSE](LICENSE).

## Credits

Reverse-engineered packet format and Safemate cloud calls: [3735943886/rf_converter](https://github.com/3735943886/rf_converter).

import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { RFOutletAccessory } from './platformAccessory';
import type { Remote } from './rfConverter';

export interface OutletConfig {
  name: string;
  remote: string;
  onKey: string;
  offKey?: string;
  stateful?: boolean;
}

interface RFPlatformConfig extends PlatformConfig {
  account?: string;
  useAndroidClient?: boolean;
  remotes?: Remote[];
  outlets?: OutletConfig[];
}

export class RFConverterPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  private readonly cfg: RFPlatformConfig;
  public readonly remotes: Map<string, Remote> = new Map();

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.cfg = config as RFPlatformConfig;
    for (const r of this.cfg.remotes ?? []) this.remotes.set(r.name, r);

    this.api.on('didFinishLaunching', () => this.discoverDevices());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private discoverDevices(): void {
    const outlets = this.cfg.outlets ?? [];
    const validOutlets: OutletConfig[] = [];
    const seenUuids = new Set<string>();

    for (const raw of outlets) {
      const remote = this.remotes.get(raw.remote);
      if (!remote) {
        this.log.warn(`Outlet "${raw.name}" references unknown remote "${raw.remote}" — skipping.`);
        continue;
      }
      if (!remote.keys.some(k => k.name === raw.onKey)) {
        this.log.warn(`Outlet "${raw.name}" references unknown ON key "${raw.onKey}" on remote "${raw.remote}" — skipping.`);
        continue;
      }
      let outlet = raw;
      if (outlet.offKey && !remote.keys.some(k => k.name === outlet.offKey)) {
        this.log.warn(`Outlet "${outlet.name}" references unknown OFF key "${outlet.offKey}" on remote "${outlet.remote}" — ignoring OFF key.`);
        outlet = { ...outlet, offKey: undefined };
      }
      validOutlets.push(outlet);

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${outlet.remote}:${outlet.name}`);
      seenUuids.add(uuid);
      const existing = this.accessories.find(a => a.UUID === uuid);

      if (existing) {
        existing.context.outlet = outlet;
        existing.context.remote = remote;
        new RFOutletAccessory(this, existing);
        this.log.info(`Restored outlet "${outlet.name}" (remote "${outlet.remote}").`);
      } else {
        const accessory = new this.api.platformAccessory(outlet.name, uuid);
        accessory.context.outlet = outlet;
        accessory.context.remote = remote;
        new RFOutletAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info(`Registered outlet "${outlet.name}" (remote "${outlet.remote}").`);
      }
    }

    // Unregister accessories no longer present
    const stale = this.accessories.filter(a => !seenUuids.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      for (const a of stale) {
        const idx = this.accessories.indexOf(a);
        if (idx >= 0) this.accessories.splice(idx, 1);
        this.log.info(`Removed stale accessory "${a.displayName}".`);
      }
    }
  }
}

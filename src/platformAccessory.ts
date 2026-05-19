import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { RFConverterPlatform, OutletConfig } from './platform';
import { type Remote, sendCommand } from './rfConverter';

export class RFOutletAccessory {
  private service: Service;
  private state = false;

  constructor(
    private readonly platform: RFConverterPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const outlet = accessory.context.outlet as OutletConfig;
    const remote = accessory.context.remote as Remote;

    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RF Converter')
      .setCharacteristic(this.platform.Characteristic.Model, 'V3.0')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `${remote.mac}:${remote.id}`);

    this.service =
      accessory.getService(this.platform.Service.Outlet) ||
      accessory.addService(this.platform.Service.Outlet);

    this.service.setCharacteristic(this.platform.Characteristic.Name, outlet.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.state)
      .onSet(async (value: CharacteristicValue) => this.handleSet(Boolean(value)));

    this.service.getCharacteristic(this.platform.Characteristic.OutletInUse)
      .onGet(() => this.state);
  }

  private async handleSet(value: boolean): Promise<void> {
    const outlet = this.accessory.context.outlet as OutletConfig;
    const remote = this.accessory.context.remote as Remote;
    const stateful = outlet.stateful !== false;

    const keyName = value ? outlet.onKey : (outlet.offKey ?? outlet.onKey);
    try {
      await sendCommand(remote, keyName);
      this.platform.log.info(`[${outlet.name}] sent key "${keyName}" on remote "${remote.name}"`);
    } catch (err) {
      this.platform.log.error(`[${outlet.name}] failed to send "${keyName}": ${(err as Error).message}`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.OPERATION_TIMED_OUT);
    }

    if (stateful) {
      this.state = value;
    } else {
      // Momentary: bounce back to off after a short delay
      this.state = false;
      setTimeout(() => {
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
        this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, false);
      }, 300);
    }
    this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, this.state);
  }
}

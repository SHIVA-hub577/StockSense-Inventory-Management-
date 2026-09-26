/**
 * Settings > Warehouses & locations, and the bin (location) page.
 */
const warehouses = require('../services/warehouseService');

const settingsPage = async (req, res) => {
  res.render('settings/warehouses', {
    title: 'Warehouses - StockSense',
    activeNav: 'warehouses',
    warehouses: await warehouses.listWarehouses(),
  });
};

const locationPage = async (req, res) => {
  const detail = await warehouses.locationDetail(req.params.id);
  res.render('locations/show', {
    title: `${detail.location.fullName} - StockSense`,
    activeNav: 'warehouses',
    ...detail,
  });
};

const apiList = async (req, res) => {
  res.json({ success: true, data: { warehouses: await warehouses.listWarehouses() } });
};

const apiCreateWarehouse = async (req, res) => {
  const warehouse = await warehouses.createWarehouse(req.body || {});
  res.status(201).json({ success: true, message: `Warehouse ${warehouse.name} (${warehouse.code}) created with a Stock location`, data: { warehouse } });
};

const apiUpdateWarehouse = async (req, res) => {
  const warehouse = await warehouses.updateWarehouse(req.params.id, req.body || {});
  res.json({ success: true, message: `Warehouse ${warehouse.name} updated`, data: { warehouse } });
};

const apiCreateLocation = async (req, res) => {
  const location = await warehouses.createLocation(req.body || {});
  res.status(201).json({ success: true, message: `Location ${location.fullName} created`, data: { location } });
};

const apiRenameLocation = async (req, res) => {
  const location = await warehouses.renameLocation(req.params.id, req.body || {});
  res.json({ success: true, message: `Location renamed to ${location.fullName}`, data: { location } });
};

const apiLocationActive = (isActive) => async (req, res) => {
  const location = await warehouses.setLocationActive(req.params.id, isActive);
  res.json({ success: true, message: `${location.fullName} ${isActive ? 'restored' : 'archived'}`, data: { location } });
};

module.exports = {
  settingsPage,
  locationPage,
  apiList,
  apiCreateWarehouse,
  apiUpdateWarehouse,
  apiCreateLocation,
  apiRenameLocation,
  apiLocationActive,
};

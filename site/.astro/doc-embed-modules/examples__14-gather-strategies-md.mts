import { cartographerDAG } from 'file:///Users/studs/Workspace/Dagonizer/examples/the-cartographer/dag.ts';
import { GeoSourceResolveDAG } from 'file:///Users/studs/Workspace/Dagonizer/examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts';
import { GeoResolvers } from 'file:///Users/studs/Workspace/Dagonizer/examples/the-cartographer/services/GeoResolvers.ts';

const services = GeoResolvers.recorded();
const geoSourceResolveDAG = GeoSourceResolveDAG.build(
  services.ipGeolocator,
  services.addressGeocoder,
).dags.find((dag) => dag.name === 'geo-source-resolve');
export { cartographerDAG, geoSourceResolveDAG };

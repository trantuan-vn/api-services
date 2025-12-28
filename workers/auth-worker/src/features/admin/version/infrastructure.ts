import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  VersionSaveResponse,
  VersionInfo,
  VersionData,
  VersionListResponse,
  IVersionInfrastructureService, VersionInfoSchema
} from './domain';
import { executeUtils } from '../../../shared/utils';

export function createVersionInfrastructureService(env: Env, userDO: DurableObjectStub<UserDO>): IVersionInfrastructureService {
  
  // Helper method để lấy dữ liệu từ Durable Object

  // Helper để lấy tất cả dữ liệu từ các bảng
  const fetchAllTableData = async () => {
    const [pricePolicies, services, vouchers] = await Promise.all([
      executeUtils.executeDynamicAction(userDO, 'select', {
        orderBy: { field: 'createdAt', direction: 'DESC' }
      }, 'price_policies'),
      executeUtils.executeDynamicAction(userDO, 'select', {
        orderBy: { field: 'createdAt', direction: 'DESC' }
      }, 'services'),
      executeUtils.executeDynamicAction(userDO, 'select', {
        orderBy: { field: 'createdAt', direction: 'DESC' }    
      }, 'vouchers')
    ]);

    return { pricePolicies, services, vouchers };
  };

  // Helper để quản lý version trong KV
  const getCurrentVersionNumber = async (): Promise<string> => {
    const currentVersion = await env.NONCE_KV.get('version:current');
    return currentVersion || '1';
  };

  const incrementVersionNumber = async (currentVersion: string): Promise<string> => {
    const newVersion = (parseInt(currentVersion) + 1).toString();
    await env.NONCE_KV.put('version:current', newVersion);
    return newVersion;
  };

  // Helper để lưu version data vào R2
  const saveVersionToR2 = async (version: string, data: any): Promise<void> => {
    await env.R2_VERSION_BUCKET.put(
      `version-${version}.json`,
      JSON.stringify(data),
      { httpMetadata: { contentType: 'application/json' } }
    );
  };


  return {
    async saveNewVersion(): Promise<VersionSaveResponse> {
      const currentVersion = await getCurrentVersionNumber();
      const newVersion = await incrementVersionNumber(currentVersion);
      
      // Lấy toàn bộ dữ liệu từ các bảng
      const { pricePolicies, services, vouchers } = await fetchAllTableData();
      
      const recordCounts = {
        price_policies: pricePolicies.length,
        services: services.length,
        vouchers: vouchers.length,
      };

      // Tạo data object để lưu
      const versionData = {
        price_policies: pricePolicies,
        services: services,
        vouchers: vouchers,
        timestamp: new Date().toISOString(),
        version: newVersion
      };

      // Lưu vào R2 và KV
      await saveVersionToR2(newVersion, versionData);

      const version = VersionInfoSchema.parse({
        version: newVersion,
        timestamp: versionData.timestamp,
        recordCounts
      });
      return await executeUtils.executeDynamicAction(userDO, 'insert', version, 'versions');
    },

    async upgradeVersion(): Promise<VersionInfo> {
      const version = await getCurrentVersionNumber();
       
      const versions = await executeUtils.executeRepositorySelect(
        userDO, 
        'SELECT version FROM versions where version = (select max(version) from versions)'
      );

      if ((versions.length > 0 && (versions[0].version !== version)) || versions.length === 0) {
        const object = await env.R2_VERSION_BUCKET.get(`version-${version}.json`);
        
        if (object) {
          const data = await object.text();
          const versionData = JSON.parse(data);
          if (!versionData) {
            throw new Error(`Version ${version} in R2 bucket not found`);
          }
          if (versionData.version !== version) {
            throw new Error(`Version ${version} in R2 bucket is incorrect`);
          }
          if (!(versionData.price_policies && Array.isArray(versionData.price_policies))
          || !(versionData.services && Array.isArray(versionData.services))
          || !(versionData.vouchers && Array.isArray(versionData.vouchers))) {
            throw new Error(`Version ${version} in R2 bucket has invalid data`);
          }
          // Tạo operations cho multi-table
          const operations = [];
          
          // Xử lý price_policies
          // Thêm lệnh delete trước khi insert
          operations.push({
            table: 'price_policies',
            operation: 'delete',
            where: { field: "datetime(expiresAt)", operator: '<', value: "datetime('now')" } 
          });
          
          // Thêm operations insert cho price_policies
          versionData.price_policies.forEach( (policy : any) => {
            operations.push({
              table: 'price_policies',
              operation: 'upsert',
              data: policy
            });
          });
          
          // Xử lý services
          // Thêm lệnh delete trước khi insert
          operations.push({
            table: 'services',
            operation: 'delete',
            where: { field: "datetime(expiresAt)", operator: '<', value: "datetime('now')" } 
          });
          
          // Thêm operations insert cho services
          versionData.services.forEach( (service : any) => {
            operations.push({
              table: 'services',
              operation: 'upsert',
              data: {
                name: service.name,
                endpoint: service.endpoint,
                expiresAt: service.expiresAt,
                isActive: service.isActive
              },
            });
          });
          
          // Xử lý vouchers
          // Thêm lệnh delete trước khi insert
          operations.push({
            table: 'vouchers',
            operation: 'delete',
            where: { field: "datetime(expiresAt)", operator: '<', value: "datetime('now')" } 
          });
          
          // Thêm operations insert cho vouchers
          versionData.vouchers.forEach( (voucher : any) => {
            operations.push({
              table: 'vouchers',
              operation: 'upsert',
              data: voucher
            });
          });
          // xử lý versions
          const recordCounts = {
            price_policies: versionData.price_policies.length,
            services: versionData.services.length,
            vouchers: versionData.vouchers.length,
          };          
          operations.push({
            table: 'versions',
            operation: 'insert',
            data: {
              version: versionData.version,
              timestamp: versionData.timestamp,
              recordCounts: recordCounts
            }
          })
          // Thực hiện multi-table operations nếu có
          if (operations.length > 0) {
            await executeUtils.executeDynamicAction(userDO, 'multi-table', {
              operations: operations
            });            
          }

        }
        else {
          throw new Error(`Version ${version} on R2_VERSION_BUCKET not found`);
        }
      }
            
      return { 
        version: version,
      };
    },
    
    async getVersionData(versionId: string): Promise<VersionData> {
      const object = await env.R2_VERSION_BUCKET.get(`version-${versionId}.json`);
      
      if (!object) {
        throw new Error(`Version ${versionId} not found`);
      }

      const data = await object.text();
      const versionData = JSON.parse(data);

      return {
        version: versionData.version,
        timestamp: versionData.timestamp,
        data: {
          price_policies: versionData.price_policies,
          services: versionData.services,
          vouchers: versionData.vouchers,
        }
      };
    },

    async getVersionList(): Promise<VersionListResponse> {
      const versions = await executeUtils.executeDynamicAction(userDO, 'select', {
        orderBy: { field: 'version', direction: 'DESC' }
      }, 'versions')
            
      return {
        versions,
        total: versions.length
      };
    },
  };
}
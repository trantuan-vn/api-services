
import { Context } from 'hono';
import { getIdFromName } from '../../../shared/utils';
import { UserDO } from '../../ws/infrastructure/UserDO';
import { createVersionInfrastructureService } from './infrastructure';
import {
  VersionSaveResponse,
  VersionInfo,
  VersionData,
  VersionListResponse,
} from './domain';

interface IVersionApplicationService {
  saveNewVersion(identifier: string): Promise<VersionSaveResponse>;
  upgradeVersion(identifier: string): Promise<VersionInfo>;
  getVersionData(identifier: string, versionId: string): Promise<VersionData>;
  getVersionList(identifier: string): Promise<VersionListResponse>;
}

export function createVersionApplicationService(c: Context, bindingName: string): IVersionApplicationService {
  const getVersionInfrastructure = (identifier: string) => {
    const userDO = getIdFromName(c, identifier, bindingName) as DurableObjectStub<UserDO>;
    if (!userDO) throw new Error(`Durable Object not found for identifier: ${identifier}`);
    return createVersionInfrastructureService(c.env, userDO);
  };

  return {
    async saveNewVersion(identifier: string): Promise<VersionSaveResponse> {
      const versionInfra = getVersionInfrastructure(identifier);
      return await versionInfra.saveNewVersion();
    },

    async upgradeVersion(identifier: string): Promise<VersionInfo> {
      const versionInfra = getVersionInfrastructure(identifier);
      return await versionInfra.upgradeVersion();
    },

    async getVersionData(identifier: string, versionId: string): Promise<VersionData> {
      const versionInfra = getVersionInfrastructure(identifier);
      return await versionInfra.getVersionData(versionId);
    },

    async getVersionList(identifier: string): Promise<VersionListResponse> {
      const versionInfra = getVersionInfrastructure(identifier);
      return await versionInfra.getVersionList();
    },
  };
}


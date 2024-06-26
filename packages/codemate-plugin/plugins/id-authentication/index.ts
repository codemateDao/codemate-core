import CryptoJS from 'crypto-js';
import { Context, Handler, param, SettingModel, superagent, SystemModel, Types, Udoc, UserModel, UserNotFoundError } from 'hydrooj';
import {
    AlreadyVerifiedError,
    DuplicatedIDNumberError,
    IDNumberValidationError,
    logger,
    RealnameVerifyResult,
    RealnameVerifyStatus,
    UserSex,
    validateIDNumber,
    VerifyNotPassError,
} from './lib';

export class IDVerifyHandler extends Handler {
    udoc: Udoc;

    async prepare() {
        // 禁止为登录请求
        if (this.user._id <= 1) throw new UserNotFoundError(this.user._id);
        const udoc = await UserModel.getById(this.domain._id, this.user._id);
        if (!udoc) throw new UserNotFoundError(this.user._id);
        this.udoc = udoc._udoc;
    }

    async get() {
        const udoc = await UserModel.getById(this.domain._id, this.user._id);
        if (!udoc) throw new UserNotFoundError(this.user._id);
        this.response.body = {
            idNumber: udoc.verifyInfo.idNumber ?? '',
            realName: udoc.verifyInfo.realName ?? '',
            verified: udoc.verifyInfo.verifyPassed,
        };
    }

    @param('idNumber', Types.String)
    @param('realName', Types.String)
    async post(_: string, idNumber: string, realName: string) {
        if (!validateIDNumber(idNumber)) throw new IDNumberValidationError(idNumber); // 过滤无效身份证号
        if (this.udoc.verifyPassed) throw new AlreadyVerifiedError(); // 不允许重复提交认证

        // 禁止重复注册（非当前用户）
        const dupNum = (await UserModel.getMulti({ idNumber }).toArray()).filter((i) => i._id !== this.user._id).length;
        if (dupNum > 0) throw new DuplicatedIDNumberError(idNumber);

        // 先写入实名信息到数据库
        if (this.udoc.realName || this.udoc.idNumber) {
            logger.warn(
                `User ${this.user._id} already have real name ${this.udoc.realName} and id number ${this.udoc.idNumber}, which will be overwritten.`,
            );
        }
        await UserModel.setById(this.user._id, {
            realName,
            idNumber,
            verifyPassed: false,
        });

        // 调用API校验
        // TODO: 在写入数据库后发起校验任务就返回 使用schedule.slowRequest和GET接口查询
        const verifyResult = await global.Hydro.lib.idVerifyV2(realName, idNumber);
        if (!verifyResult.success) throw new VerifyNotPassError();
        const { result, sex, success, ...infos } = verifyResult;
        await UserModel.setById(this.user._id, {
            verifyPassed: result === RealnameVerifyStatus.MATCH,
            ...infos,
            sex: sex === '女' ? UserSex.FEMALE : UserSex.MALE,
        });

        this.response.body = {
            success: true,
            code: result,
            idNumber,
            realName,
        };
    }
}

export function apply(ctx: Context) {
    ctx.Route('id_verify', '/user/verify', IDVerifyHandler);
    ctx.inject(['setting'], (c) => {
        c.setting.SystemSetting(SettingModel.Setting('setting_secrets', 'idVerify.appCode', '', 'text', 'idVerify AppCode (LEGACY)'));
        c.setting.SystemSetting(SettingModel.Setting('setting_secrets', 'idVerify.appSecretId', '', 'text', 'idVerify SecretId'));
        c.setting.SystemSetting(SettingModel.Setting('setting_secrets', 'idVerify.appSecretKey', '', 'text', 'idVerify SecretKey'));
    });
    const processResponse = (response: superagent.Response): RealnameVerifyResult => {
        if (response.body.code !== '0' && response.body.code !== 200) {
            return {
                success: false,
            };
        }
        const matchResult = {
            '1': RealnameVerifyStatus.MATCH,
            '2': RealnameVerifyStatus.NOT_MATCH,
            '3': RealnameVerifyStatus.NOT_FOUND,
        };
        response.body.result ||= response.body.data; // don't be lazy as me
        return {
            success: true,
            result: matchResult[response.body.result.res as '1' | '2' | '3'],
            sex: response.body.result.sex,
            birthday: response.body.result.birthday,
            address: response.body.result.address,
            description: response.body.result.description,
        };
    };
    global.Hydro.lib.idVerify = async (name: string, idCard: string): Promise<RealnameVerifyResult> => {
        const appCode = await SystemModel.get('idVerify.appCode');
        const response = await superagent
            .post('https://eid.shumaidata.com/eid/check')
            .query({
                idcard: idCard,
                name,
            })
            .set('Authorization', `APPCODE ${appCode}`)
            .send();
        return processResponse(response);
    };
    global.Hydro.lib.idVerifyV2 = async (name: string, idCard: string): Promise<RealnameVerifyResult> => {
        function getSign(secretId: string, secretKey: string) {
            // this is a piece of shit from the document
            const datetime = new Date().toUTCString();
            const signStr = `x-date: ${datetime}\nx-source: market`;
            const sign = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(signStr, secretKey));
            return `hmac id="${secretId}", algorithm="hmac-sha1", headers="x-date x-source", signature="${sign}"`;
        }

        const [secretId, secretKey] = await Promise.all([SystemModel.get('idVerify.appSecretId'), SystemModel.get('idVerify.appSecretKey')]);
        if (!secretId || !secretKey) return { success: false };
        const response = await superagent
            .post('https://service-olvzprl7-1308811306.sh.apigw.tencentcs.com/release/id_name/check')
            .set({
                'X-Source': 'market',
                'X-Date': new Date().toUTCString(),
                Authorization: getSign(secretId, secretKey),
            })
            .query({
                idcard: idCard,
                name,
            });
        logger.debug(response.body);
        return processResponse(response);
    };
}

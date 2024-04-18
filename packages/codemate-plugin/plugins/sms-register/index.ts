import { nanoid } from 'nanoid';
import {
    BlacklistedError, BlackListModel,
    Context, Handler, param, PERM, PRIV, SettingModel, superagent, SystemModel, TokenModel, Types,
    UserAlreadyExistError, UserModel, ValidationError,
} from 'hydrooj';
import {
    logger, SendSMSFailedError, VerifyCodeError, VerifyTokenCheckNotPassedError,
} from './lib';

declare module 'hydrooj' {
    interface Lib {
        sms: (msg: string, targetPhoneNumber: string) => Promise<boolean>;
    }
}

export function doVerifyToken(verifyToken: string) {
    // 检查一个 token 是否合法（防止机器人注册）
    return !!verifyToken; // TODO implement this
}

export class RequestSMSCodeHandler extends Handler {
    @param('phoneNumber', Types.String)
    @param('verifyToken', Types.String)
    async post(domainId: string, phoneNumber: string, verifyToken: string) {
        const verifyResult = doVerifyToken(verifyToken);
        if (!verifyResult) throw new VerifyTokenCheckNotPassedError();
        if (await UserModel.getByPhone(domainId, phoneNumber)) throw new UserAlreadyExistError(phoneNumber);
        const verifyCode = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        const sendResult = await global.Hydro.lib.sms(`【codemate】您的验证码是${verifyCode}，600s内有效`, phoneNumber);
        if (!sendResult) throw new SendSMSFailedError();
        await Promise.all([
            this.limitRate('send_message_code', 600, 3, false),
            this.limitRate(`send_message_code_${phoneNumber}`, 60, 1, false),
        ]);
        const id = nanoid();
        await TokenModel.add(TokenModel.TYPE_REGISTRATION, 600, { phoneNumber, verifyCode }, id);
        this.response.body = {
            success: true,
            tokenId: id,
            code: 0,
        };
    }
}

export class RegisterWithSMSCodeHandler extends Handler {
    @param('tokenId', Types.String)
    @param('verifyCode', Types.String)
    @param('phoneNumber', Types.String)
    @param('username', Types.String)
    @param('password', Types.String)
    async post(domainId: string, tokenId: string, verifyCode: string, phoneNumber: string, username: string, password: string) {
        const token = await TokenModel.get(tokenId, TokenModel.TYPE_REGISTRATION);
        if (!token) throw new VerifyCodeError();
        if (token.phoneNumber !== phoneNumber) throw new ValidationError('phoneNumber');
        if (token.verifyCode !== verifyCode) throw new VerifyCodeError();
        const mail = `${nanoid()}@local.aioj.net`;
        const uid = await UserModel.create(mail, username, password, undefined, this.request.ip);
        await UserModel.setById(uid, { phoneNumber });
        await TokenModel.del(tokenId, TokenModel.TYPE_REGISTRATION);
        this.session.uid = uid;
        this.session.sudoUid = null;
        this.session.scope = PERM.PERM_ALL.toString();
        this.session.recreate = true;
        this.response.body = {
            success: true,
            code: 0,
            uid,
        };
    }
}

export class RequestEmailCodeHandler extends Handler {
    @param('mail', Types.String)
    @param('verifyToken', Types.String)
    async post(domainId: string, mail: string, verifyToken: string) {
        const verifyResult = doVerifyToken(verifyToken);
        if (!verifyResult) throw new VerifyTokenCheckNotPassedError();
        if (await UserModel.getByEmail('system', mail)) throw new UserAlreadyExistError(mail);
        const mailDomain = mail.split('@')[1];
        if (await BlackListModel.get(`mail::${mailDomain}`)) throw new BlacklistedError(mailDomain);
        await Promise.all([
            this.limitRate(`send_mail_${mail}`, 60, 3, false),
            this.limitRate('send_mail', 3600, 30, false),
        ]);

        const verifyCode = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        const html = await this.renderHTML('user_register_mail.html', {
            verifyCode,
        });
        await global.Hydro.lib.mail.sendMail(mail, 'Codemate 注册验证码', 'Codemate 注册验证码', html);
        const id = nanoid();
        await TokenModel.add(TokenModel.TYPE_REGISTRATION, 600, { mail, verifyCode }, id);

        this.response.body = {
            success: true,
            tokenId: id,
            code: 0,
        };
    }
}

export class RegisterWithEmailCodeHandler extends Handler {
    @param('tokenId', Types.String)
    @param('verifyCode', Types.String)
    @param('mail', Types.String)
    @param('username', Types.String)
    @param('password', Types.String)
    async post(domainId: string, tokenId: string, verifyCode: string, mail: string, username: string, password: string) {
        const token = await TokenModel.get(tokenId, TokenModel.TYPE_REGISTRATION);
        if (!token) throw new VerifyCodeError();
        if (token.mail !== mail) throw new ValidationError('mail');
        if (token.verifyCode !== verifyCode) throw new VerifyCodeError();
        const uid = await UserModel.create(mail, username, password, undefined, this.request.ip);
        await TokenModel.del(tokenId, TokenModel.TYPE_REGISTRATION);
        this.session.uid = uid;
        this.session.sudoUid = null;
        this.session.scope = PERM.PERM_ALL.toString();
        this.session.recreate = true;
        this.response.body = {
            success: true,
            code: 0,
            uid,
        };
    }
}

export function apply(ctx: Context) {
    ctx.inject(['setting'], (c) => {
        c.setting.SystemSetting(
            SettingModel.Setting('setting_sms', 'sms_username', '', 'text', 'SMS Username'),
            SettingModel.Setting('setting_sms', 'sms_password', '', 'text', 'SMS Password'),
        );
    });
    ctx.Route('register_with_sms_code', '/user/register/sms', RegisterWithSMSCodeHandler, PRIV.PRIV_REGISTER_USER);
    ctx.Route('register_request_sms_code', '/user/register/sms/code', RequestSMSCodeHandler, PRIV.PRIV_REGISTER_USER);
    ctx.Route('register_with_email_code', '/user/register/email', RegisterWithEmailCodeHandler, PRIV.PRIV_REGISTER_USER);
    ctx.Route('request_email_code', '/user/register/email/code', RequestEmailCodeHandler, PRIV.PRIV_REGISTER_USER);
    global.Hydro.lib.sms = async (msg: string, targetPhoneNumber: string) => {
        const username: string = SystemModel.get('sms_username');
        const password: string = SystemModel.get('sms_password');
        const response = await superagent.get('https://api.smsbao.com/sms')
            .query({
                u: username,
                p: password,
                m: targetPhoneNumber,
                c: msg,
            })
            .send();
        if (response.text !== '0') logger.error(`Failed to send sms, response=${response.text}.`);
        return response.text === '0';
    };
}

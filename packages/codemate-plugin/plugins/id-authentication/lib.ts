import { Err, ForbiddenError, superagent, ValidationError } from 'hydrooj';

export const IDNumberValidationError = Err('IDNumberValidationError', ValidationError, 'ID number {0} is invalid.');
export const VerifyNotPassError = Err('VerifyNotPassError', ForbiddenError, 'Real-name info verification failed.');

export const enum RealnameVerifyStatus {
    MATCH,
    NOT_MATCH,
    NOT_FOUND,
}

export const enum UserSex {
    UNKNOWN = 3,
    MALE = 1,
    FEMALE = 2,
}

export type RealnameVerifyResult =
    | {
          success: false;
      }
    | {
          success: true;
          result: RealnameVerifyStatus;
          description: string; // 注释
          sex: '男' | '女';
          birthday: string; // '20240420'
          address: string; // 住址
      };

export const validateIDNumber = (idNumber: string) => {
    if (idNumber.length !== 18) {
        return false;
    }
    const factors = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodeDict = { 0: '1', 1: '0', 2: 'X', 3: '9', 4: '8', 5: '7', 6: '6', 7: '5', 8: '4', 9: '3', 10: '2' };
    let total = 0;
    for (let i = 0; i < 17; i++) {
        total += parseInt(idNumber[i], 10) * factors[i];
    }
    const checkCode = checkCodeDict[total % 11];
    return checkCode === idNumber[17];
};

declare module 'hydrooj' {
    interface Lib {
        idVerify: (name: string, idCard: string) => Promise<RealnameVerifyResult>;
    }

    interface Udoc {
        realName?: string;
        idNumber?: string;
        verifyPassed?: boolean;
        sex?: UserSex;
    }
}

global.Hydro.lib.idVerify = async (name: string, idCard: string) => {
    const appCode = '1689f16d61504a14aca0bc26eb318f53';
    const response = await superagent
        .post('https://eid.shumaidata.com/eid/check')
        .query({
            idcard: idCard,
            name,
        })
        .set('Authorization', `APPCODE ${appCode}`)
        .send();
    if (response.body.code !== '0') {
        return {
            success: false,
        };
    }
    const matchResult = {
        '1': RealnameVerifyStatus.MATCH,
        '2': RealnameVerifyStatus.NOT_MATCH,
        '3': RealnameVerifyStatus.NOT_FOUND,
    };
    return {
        success: true,
        result: matchResult[response.body.result.res as '1' | '2' | '3'],
        sex: response.body.result.sex,
        birthday: response.body.result.birthday,
        address: response.body.result.address,
        description: response.body.result.description,
    };
};

import { ContestNotFoundError, DocumentModel as document, Filter, ObjectId, PERM, Projection, Tdoc, UserModel } from 'hydrooj';
import { GroupModel } from '../privilege-group/model';

const TYPE_SYSTEM_PLIST = document.TYPE_SYSTEM_PLIST;

export interface SystemPList extends Omit<Tdoc, 'docType'> {
    docType: typeof TYPE_SYSTEM_PLIST;
    parent: ObjectId;
    children?: ObjectId[];
}

export async function get(domainId: string, tid: ObjectId, projection?: Projection<SystemPList>): Promise<SystemPList> {
    const tdoc = await document.get(domainId, TYPE_SYSTEM_PLIST, tid, projection);
    if (!tdoc) throw new ContestNotFoundError(tid);
    return tdoc;
}

export function getMulti(domainId: string, query: Filter<document.DocType['32']> = {}, projection?: Projection<SystemPList>) {
    return document.getMulti(domainId, TYPE_SYSTEM_PLIST, query, projection).sort({ beginAt: -1 });
}

export async function getWithChildren(domainId: string, tid: ObjectId, projection?: Projection<SystemPList>): Promise<SystemPList> {
    const root = await get(domainId, tid, projection);
    if (root.children?.length) {
        const subPids = await Promise.all(root.children.map(async (c) => (await getWithChildren(domainId, c)).pids));
        root.pids.push(...Array.from(new Set(subPids.flat())));
    }
    return root;
}

export async function add(
    domainId: string,
    title: string,
    content: string,
    owner: number,
    rule = 'homework',
    beginAt = new Date(),
    endAt = new Date(),
    pids: number[] = [],
    rated = false,
    data: Partial<SystemPList> = {},
    parent: ObjectId = null,
) {
    Object.assign(data, {
        content,
        owner,
        title,
        rule,
        beginAt,
        endAt,
        pids,
        attend: 0,
    });
    // await app.parallel('contest/before-add', data);
    const res = await document.add(domainId, content, owner, TYPE_SYSTEM_PLIST, null, null, null, {
        ...data,
        title,
        rule,
        beginAt,
        endAt,
        pids,
        attend: 0,
        rated,
        parent,
    });
    if (parent) {
        // @ts-ignore
        await document.set(domainId, TYPE_SYSTEM_PLIST, parent, undefined, undefined, { children: res });
    }
    // await app.parallel('contest/add', data, res);
    return res;
}

export async function edit(domainId: string, tid: ObjectId, $set: Partial<SystemPList>) {
    const tdoc = await document.get(domainId, TYPE_SYSTEM_PLIST, tid);
    if (!tdoc) throw new ContestNotFoundError(domainId, tid);
    return await document.set(domainId, TYPE_SYSTEM_PLIST, tid, $set);
}

export async function del(domainId: string, tid: ObjectId) {
    await Promise.all([
        document.deleteOne(domainId, TYPE_SYSTEM_PLIST, tid),
        document.deleteMultiStatus(domainId, TYPE_SYSTEM_PLIST, { docId: tid }),
    ]);
}

export async function checkPerm(domainId: string, tid: ObjectId, uid: number) {
    const tdoc = await get(domainId, tid);
    const user = await UserModel.getById(domainId, uid);
    const isAssigned = (await Promise.all(tdoc.assign?.map?.((group) => GroupModel.has(domainId, user._id, group)) ?? [])).some(Boolean);

    return user.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN) || user.own(tdoc) || isAssigned;
}

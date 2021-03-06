import creditRoles from "./creditRoles";
import schedule from "node-schedule";
import { client } from "../../index";
import { info } from "../../util/debug";
import { pmdDB } from "../../database/client";

const creditsColl = pmdDB.collection("credits");

async function updateCredits() {
	info("Updating credits...");

	const creditUsers = (
		await client.guilds.cache.first().members.fetch()
	).filter(m =>
		Object.values(creditRoles).find(cR => m.roles.cache.keyArray().includes(cR))
			? true
			: false
	);

	let credits = creditUsers.map(m => {
		const highestRole = m.roles.cache.get(
			containsAny(Object.values(creditRoles), m.roles.cache.keyArray())[0]
		);

		return {
			userId: m.id,
			name: m.user.username,
			tag: m.user.discriminator,
			avatar: m.user.displayAvatarURL({
				format: "png",
				dynamic: true
			}),
			premium_since: m.premiumSince ? m.premiumSinceTimestamp : undefined,
			role: highestRole.name,
			roleId: highestRole.id,
			roles: m.roles.cache.filter(r => r.name !== "@everyone").map(r => r.name),
			roleIds: m.roles.cache.filter(r => r.name !== "@everyone").map(r => r.id),
			roleColor: highestRole.hexColor,
			rolePosition: highestRole.position,
			status: m.user.presence.status
		};
	});

	await creditsColl.bulkWrite(
		credits.map(cU => {
			return {
				updateOne: {
					filter: { userId: cU.userId },
					update: { $set: cU },
					upsert: true
				}
			};
		})
	);

	const dbCredits = await creditsColl
			.find({}, { projection: { _id: false, userId: true } })
			.toArray(),
		usersToRemove = dbCredits.filter(
			mC => !credits.find(cU => cU.userId === mC.userId)
		);

	if (usersToRemove.length > 0)
		await creditsColl.bulkWrite(
			usersToRemove.map(uTR => {
				return {
					deleteOne: { filter: { userId: uTR.userId } }
				};
			})
		);

	info("Updated credits.");
}

async function updateFlags() {
	info("Updating flags...");

	let flagUsers = [];

	await Promise.all(
		client.guilds.cache
			.first()
			.roles.cache.filter(r => Object.values(creditRoles).includes(r.id))
			.map(async r => {
				const memberArray = r.members.array();
				for (let i = 0; i < r.members.size; i++) {
					const member = memberArray[i];

					// @ts-ignore
					const userFlags = (await member.user.fetchFlags()).toArray();

					if (!flagUsers.find(cU => cU.userId === member.id))
						flagUsers.push({
							userId: member.id,
							flags: userFlags.length > 0 ? userFlags : undefined
						});
				}
			})
	);

	info("Pushing flag changes to database...");

	creditsColl.bulkWrite(
		flagUsers.map(cU => {
			return {
				updateOne: {
					filter: { userId: cU.userId },
					update: {
						$set: cU
					},
					upsert: true
				}
			};
		})
	);

	info("Updated flags.");
}

//* create the task for every 6th hour and immediately execute it
//* https://crontab.guru/#0_*/6_*_*_*
schedule.scheduleJob("flag updater", "0 */6 * * *", updateFlags);
//* create the task for every 15th minute and immediately execute it
//* https://crontab.guru/#*/15_*_*_*_*
schedule.scheduleJob("credits updater", "*/15 * * * *", updateCredits).invoke();

function containsAny(source: Array<string>, target: Array<string>) {
	let result = source.filter(function (item) {
		return target.indexOf(item) > -1;
	});
	return result;
}

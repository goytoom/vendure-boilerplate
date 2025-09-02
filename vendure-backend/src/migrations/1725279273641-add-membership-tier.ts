import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMembershipTier1725279273641 implements MigrationInterface {
    name = 'AddMembershipTier1725279273641'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "customer" ADD COLUMN "customFieldsMembershipTier" character varying`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "customer" DROP COLUMN "customFieldsMembershipTier"`
        );
    }
}

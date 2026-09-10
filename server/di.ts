import "reflect-metadata";
import { container } from "tsyringe";
import { db } from "./db";
import { UserRepository } from "./repositories/user.repository";

container.register("DrizzleClient", { useValue: db });

container.registerSingleton(UserRepository);

export { container };

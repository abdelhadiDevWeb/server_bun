import Joi from "joi";

interface IAppConfig {
  PORT: number;
  JwtSecret: string;
  RefrechToken: string;
  SecretSession: string;
  UrlFront : string;
}

export const AppConfig: IAppConfig = {
  PORT: +process.env.PORT!,
  JwtSecret: process.env.JWT_SECRET!,
  RefrechToken: process.env.REFRECHTOKEN!,
  SecretSession : process.env.SECRETSESSION!,
  UrlFront : process.env.URLFRONT!
};

const SchemaValidetionConfig = Joi.object({
  JwtSecret: Joi.string().required(),
  PORT: Joi.number().integer().required(),
  RefrechToken: Joi.string().required(),
  SecretSession: Joi.string().required(),
  UrlFront: Joi.string().required(),
});


export const ValidatAppConfig = (callback: () => void) => {
     const {error} = SchemaValidetionConfig.validate(AppConfig);

     if(error) {
          throw error.message;
     }

     callback();
}
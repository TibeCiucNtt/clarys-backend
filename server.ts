import express from "express";
import cors from 'cors';
import cluster from "cluster";
import os from "os";
import { join } from 'path';
import {Container} from 'inversify'
import "reflect-metadata";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUiExpress from "swagger-ui-express";
import {fsReadFile} from 'ts-loader/dist/utils';
import * as process from 'process';

import { Config } from "./src/config/config";

import { PolkassemblyService } from './src/services/polkassembly.service'

import { AwsStorageService } from './src/helpers/awsStorage.service';
import { responseWrapper } from './src/middleware/response.middleware';
import { SwaggerHelper } from './src/helpers/swaggerHelper';

// import './src/controllers/s3.controller';
import './src/controllers/polkassembly.controller';

import { InversifyExpressServer } from "inversify-express-utils";

const configs = new Config().getConfig();
const port = (process.env.PORT) ? process.env.PORT : configs.port;
const cCPUs = (process.env.NODE_ENV && process.env.NODE_ENV === 'production') ? os.cpus().length : 1;

const startDate = new Date();

function setupStatusPage(app){
    app.get('/', (req, res)=>{
        let file = fsReadFile(join(__dirname, 'public', 'index.html'));

        if(file){
            file = file.replace('{{applicationName}}', 'LucidAI Express API Server');
            file = file.replace('{{serverStartDate}}', startDate.toISOString());
            file = file.replace('{{serverUptime}}', `${ (new Date().getTime() - startDate.getTime()) / 1000 } seconds`);
            file = file.replace('{{swaggerURL}}', '/swagger');
        }
        
        res.send(file);
    })
}

function bindServices(container: Container){
    container
    .bind<PolkassemblyService>(PolkassemblyService.name)
    .to(PolkassemblyService)

    container
    .bind<AwsStorageService>(AwsStorageService.name)
    .to(AwsStorageService)
}

function setupSwagger(app){
    
    const swaggerOptions = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Hello',
                version: '1.0.0'
            },
            components:{}
        },
        apis: [
            './src/controllers/*.ts',
            './src/controllers/polkassembly.controller.ts',
            __dirname + '/src/controllers/*.ts',
        ]
    }

    const swaggerDocs: any = swaggerJsdoc(swaggerOptions);
    const helper = new SwaggerHelper();
    helper.addSwaggerResponseSchema(swaggerDocs);
    app.use('/swagger', swaggerUiExpress.serve, swaggerUiExpress.setup(swaggerDocs))

}

if(cluster.isPrimary){
    for(let i = 0; i < cCPUs; i++){
        cluster.fork();
    }

    cluster.on('online', function (worker){
        console.log('Worker ' + worker.process.pid + ' is online')
    })

    cluster.on('exit', function (worker){
        console.log('Worker ' + worker.process.pid + ' closed')
    })
}else{
    const container = new Container();
    bindServices(container);
    
    console.log(container.get<express.RequestHandler>(PolkassemblyService.name))

    const server = new InversifyExpressServer(
        container,
        null,
        null,
        null,
        null
    );

    server.setConfig((app) =>{
        setupSwagger(app);
        app.use(cors());
        app.use(responseWrapper);
        app.use(express.json());
    });

    const app: express.Application = server.build();
    app.listen(port);
    setupStatusPage(app);

    const serverInfo = {
        'API Port': port,
        'Localhost URL': `http://localhost:${port}`,
        'Swagger URL': `http://localhost:${port}/swagger`
    };

    console.table(serverInfo);

}
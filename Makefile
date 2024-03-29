build:
	docker build -t animationconverterbot .

clean:
	docker stop AnimationConverterBot
	docker rm AnimationConverterBot

deploy:
	docker run -d -it --name=AnimationConverterBot animationconverterbot
	
local: build clean deploy

cloud-build:
	gcloud builds submit --tag gcr.io/commish-me/animation-converter:1.0.0 .

cloud-deploy:
	gcloud run deploy animation-converter --image=gcr.io/commish-me/animation-converter:1.0.0 --platform managed --port 3000

cloud: cloud-build cloud-deploy